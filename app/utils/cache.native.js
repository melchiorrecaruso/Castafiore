import AsyncStorage from '@react-native-async-storage/async-storage'
import * as FileSystem from 'expo-file-system'
import { DeviceEventEmitter } from 'react-native'
import md5 from 'md5'
import logger from '~/utils/logger'
import {
	clearCachedAudio,
	clearCachedCovers,
	deleteCachedSong,
	getCachedAudio,
	getCachedCover,
	getCachedMediaInfo as getDatabaseCachedMediaInfo,
	getServerId,
	saveCover,
} from '~/utils/cacheDatabase'

const coverDownloads = new Map()
const coverDownloadQueue = []
const MAX_COVER_DOWNLOADS = 4
let activeCoverDownloads = 0
const SONG_CACHE_CHANGED = 'song-cache-changed'

const acquireCoverDownloadSlot = async () => {
	if (activeCoverDownloads >= MAX_COVER_DOWNLOADS) {
		await new Promise(resolve => coverDownloadQueue.push(resolve))
	}
	activeCoverDownloads += 1
}

const releaseCoverDownloadSlot = () => {
	activeCoverDownloads -= 1
	coverDownloadQueue.shift()?.()
}

export const notifySongCacheChanged = songId => {
	DeviceEventEmitter.emit(SONG_CACHE_CHANGED, { songId })
}

export const subscribeSongCacheChanged = callback => {
	return DeviceEventEmitter.addListener(SONG_CACHE_CHANGED, callback)
}

// API Cache
export const getJsonCache = async (_cacheName, key) => {
	const json = await AsyncStorage.getItem(key)
	return json ? JSON.parse(json) : null
}

export const setJsonCache = async (_cacheName, key, json) => {
	if (!json) return
	await AsyncStorage.setItem(key, JSON.stringify(json))
}

// Song Cache
export const isSongCached = async (config, songId, streamFormat, _maxBitRate) => {
	const cachedAudio = await getCachedAudio(config || global.config, songId, streamFormat)
	if (!cachedAudio) return false
	const path = getPathSong(songId, streamFormat)
	return FileSystem.getInfoAsync(path)
		.then(info => info.exists && info.size > 0 && (!cachedAudio.fileSize || info.size === cachedAudio.fileSize))
		.catch(() => false)
}

export const getSongCachedInfo = async (config, songId, streamFormat, _maxBitRate) => {
	const cachedAudio = await getCachedAudio(config || global.config, songId, streamFormat)
	if (!cachedAudio) return null
	const path = getPathSong(songId, streamFormat)

	return await FileSystem.getInfoAsync(path)
		.then(info => {
			return [
				{ title: 'File', value: `${songId}.${streamFormat}` },
				{ title: 'Max bitrate', value: cachedAudio.maxBitRate || 0 },
				{ title: 'Is cached', value: info.exists ? 'Yes' : 'No' },
				{ title: 'Size', value: `${(info.size / (1024 * 1024)).toFixed(2)} MB` },
				{ title: 'Modified', value: new Date(info.modificationTime).toLocaleString() },
			]
		})
		.catch(() => null)
}

export const deleteSongCache = async (config, songId, streamFormat, _maxBitRate) => {
	const activeConfig = config || global.config
	const pathSong = getPathSong(songId, streamFormat)
	await FileSystem.deleteAsync(pathSong, { idempotent: true })
	const coverFiles = await deleteCachedSong(activeConfig, songId, streamFormat)
	await Promise.all(coverFiles.map(filePath => FileSystem.deleteAsync(filePath, { idempotent: true })))
	notifySongCacheChanged(songId)
}

// Cover Cache
const getCoverSize = uri => uri?.match(/[?&]size=([^&]+)/)?.[1] || 'original'
const getCoverFileName = (coverArt, uri) => md5(`${coverArt}@${getCoverSize(uri)}`)

const getPathDirCover = () => {
	return `${FileSystem.documentDirectory}/cache/${global.config.folderCache}/covers/`
}

const getPathCover = (coverArt, uri) => {
	return `${getPathDirCover()}${getCoverFileName(coverArt, uri)}`
}

export const getCoverCachedUri = async (coverArt, uri) => {
	if (global.isCoverCaching === false || !coverArt) return null
	const cachedCover = await getCachedCover(global.config, coverArt, getCoverSize(uri))
	const filePath = cachedCover?.filePath || getPathCover(coverArt, uri)
	const info = await FileSystem.getInfoAsync(filePath).catch(() => null)
	if (!info?.exists || info.size <= 0) return null
	if (!cachedCover?.filePath) {
		saveCover({
			serverId: getServerId(global.config),
			coverArtId: coverArt,
			size: getCoverSize(uri),
			filePath,
			fileSize: info.size,
		}).catch(error => logger.error('cacheCover', `Unable to reconcile cached cover: ${error}`))
	}
	return filePath
}

export const cacheCover = async (uri, coverArt) => {
	if (global.isCoverCaching === false || !uri?.startsWith('http') || !coverArt) return null

	const cachedUri = await getCoverCachedUri(coverArt, uri)
	if (cachedUri) return cachedUri

	const fileName = getCoverFileName(coverArt, uri)
	if (!coverDownloads.has(fileName)) {
		coverDownloads.set(fileName, (async () => {
			const path = getPathCover(coverArt, uri)
			const partPath = `${path}.part`
			await FileSystem.makeDirectoryAsync(getPathDirCover(), { intermediates: true })
			await acquireCoverDownloadSlot()
			try {
				const result = await FileSystem.downloadAsync(uri, partPath)
				if (result.status !== 200) throw new Error(`HTTP ${result.status}`)
				await FileSystem.deleteAsync(path, { idempotent: true })
				await FileSystem.moveAsync({ from: partPath, to: path })
				const info = await FileSystem.getInfoAsync(path)
				await saveCover({
					serverId: getServerId(global.config),
					coverArtId: coverArt,
					size: getCoverSize(uri),
					filePath: path,
					fileSize: info.size,
				}).catch(error => logger.error('cacheCover', `Unable to register cached cover: ${error}`))
				return path
			} catch (error) {
				await FileSystem.deleteAsync(partPath, { idempotent: true }).catch(() => {})
				throw error
			} finally {
				releaseCoverDownloadSlot()
			}
		})().finally(() => coverDownloads.delete(fileName)))
	}

	return coverDownloads.get(fileName)
}

const initCacheCover = async () => {
	await FileSystem.makeDirectoryAsync(getPathDirCover(), { intermediates: true })
		.catch(error => logger.error('initCacheCover', error))
}

export const getPlayableCachedSongs = async () => {
	const { cachedSongs } = await getCachedMediaInfo()
	const playable = await Promise.all(cachedSongs.map(async song => {
		const paths = String(song.cachedFormats || '').split('|').filter(Boolean)
			.map(format => getPathSong(song.id, format))
		const valid = await Promise.all(paths.map(path => FileSystem.getInfoAsync(path).catch(() => null)))
		return valid.some(info => info?.exists && info.size > 0) ? song : null
	}))
	return Array.from(new Map(playable.filter(Boolean).map(song => [String(song.id), song])).values())
}

export const getPlayableCachedArtists = async () => {
	const cachedSongs = await getPlayableCachedSongs()
	const artists = new Map()
	for (const song of cachedSongs) {
		if (song.artistId) {
			artists.set(String(song.artistId), {
				id: song.artistId,
				name: song.artist,
				coverArt: song.artistCoverArt,
				albumCount: song.artistAlbumCount,
				starred: song.artistStarred,
			})
		}
		for (const artist of song.artists || []) {
			if (!artists.has(String(artist.id))) artists.set(String(artist.id), artist)
		}
		for (const artist of song.albumArtists || []) {
			if (!artists.has(String(artist.id))) artists.set(String(artist.id), artist)
		}
	}
	return Array.from(artists.values())
}

export const getPlayableCachedAlbums = async () => {
	const cachedSongs = await getPlayableCachedSongs()
	const albums = new Map()

	cachedSongs.forEach(song => {
		if (!song.albumId) return
		const albumId = String(song.albumId)
		if (albums.has(albumId)) return
		albums.set(albumId, {
			id: song.albumId,
			name: song.album,
			album: song.album,
			artist: song.artist,
			artistId: song.artistId,
			coverArt: song.albumCoverArt,
			year: song.albumYear,
			starred: song.albumStarred,
			userRating: song.albumUserRating,
			averageRating: song.albumAverageRating,
			songCount: song.albumSongCount,
			duration: song.albumDuration,
		})
	})

	return Array.from(albums.values())
}

export const searchPlayableCachedMedia = async query => {
	const normalizedQuery = String(query || '').trim().toLocaleLowerCase()
	const [album, artist, song] = await Promise.all([
		getPlayableCachedAlbums(),
		getPlayableCachedArtists(),
		getPlayableCachedSongs(),
	])
	const matches = item => [item.name, item.title, item.album, item.artist]
		.some(value => String(value || '').toLocaleLowerCase().includes(normalizedQuery))
	return {
		album: album.filter(matches),
		artist: artist.filter(matches),
		song: song.filter(matches),
	}
}

const getCachedMediaInfo = async () => {
	return getDatabaseCachedMediaInfo(global.config, global.streamFormat)
}

export const getPathSong = (songId, streamFormat) => {
	return `${getPathDir()}${songId}.${streamFormat}`
}


const getPathDir = () => {
	return `${FileSystem.documentDirectory}/cache/${global.config.folderCache}/songs/`
}

export const initCacheSong = async () => {
	await FileSystem.makeDirectoryAsync(getPathDir(), { intermediates: true })
		.catch(error => {
			logger.error('initCacheSong', error)
		})
	await initCacheCover()
}

// Cache Settings
export const clearCache = async () => {
	await AsyncStorage.multiRemove(
		await AsyncStorage.getAllKeys()
			.then(keys => keys.filter(key => key.startsWith('http')))
			.catch(() => [])
	)
}

export const clearSongCache = async () => {
	const pathDir = getPathDir()
	await FileSystem.readDirectoryAsync(pathDir)
		.then(files => Promise.all(files.map(file => FileSystem.deleteAsync(`${pathDir}${file}`, { idempotent: true }))))
		.catch(() => [])
	await clearCachedAudio(global.config)
	await initCacheSong()
	notifySongCacheChanged(null)
}

export const clearCoverCache = async () => {
	await Promise.allSettled([...coverDownloads.values()])
	const pathDir = getPathDirCover()
	await FileSystem.readDirectoryAsync(pathDir)
		.then(files => Promise.all(files.map(file => FileSystem.deleteAsync(`${pathDir}${file}`, { idempotent: true }))))
		.catch(() => [])
	await clearCachedCovers(global.config)
	await initCacheCover()
}

const getFilesStat = async (directory, includeFile = () => true) => {
	const files = await FileSystem.readDirectoryAsync(directory).catch(() => [])
	const selectedFiles = files.filter(includeFile)
	const infos = await Promise.all(selectedFiles.map(file => (
		FileSystem.getInfoAsync(`${directory}${file}`).catch(() => null)
	)))
	return {
		count: infos.filter(info => info?.exists && !info.isDirectory).length,
		size: infos.reduce((total, info) => total + (info?.exists && !info.isDirectory ? info.size || 0 : 0), 0),
	}
}

const getUtf8Size = value => Array.from(String(value || '')).reduce((size, character) => {
	const codePoint = character.codePointAt(0)
	if (codePoint <= 0x7f) return size + 1
	if (codePoint <= 0x7ff) return size + 2
	if (codePoint <= 0xffff) return size + 3
	return size + 4
}, 0)

const formatBytes = bytes => {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export const getStatCache = async () => {
	const apiKeys = await AsyncStorage.getAllKeys()
		.then(keys => keys.filter(key => key.startsWith('http')))
		.catch(() => [])
	const apiEntries = await AsyncStorage.multiGet(apiKeys).catch(() => [])
	const apiSize = apiEntries.reduce((total, [key, value]) => total + getUtf8Size(key) + getUtf8Size(value), 0)
	const [songs, covers] = await Promise.all([
		getFilesStat(getPathDir(), file => !file.endsWith('.part')),
		getFilesStat(getPathDirCover(), file => !file.endsWith('.part')),
	])
	return [
		{
			name: 'Cache Api',
			count: apiKeys.length,
		},
		{
			name: 'Cache Api Size',
			count: formatBytes(apiSize),
		},
		{
			name: 'Cache Songs',
			count: songs.count,
		},
		{
			name: 'Cache Songs Size',
			count: formatBytes(songs.size),
		},
		{
			name: 'Cache Covers',
			count: covers.count,
		},
		{
			name: 'Cache Covers Size',
			count: formatBytes(covers.size),
		},
	]
}
