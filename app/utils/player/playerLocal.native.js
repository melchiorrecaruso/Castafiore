import TrackPlayer, { AppKilledPlaybackBehavior, Capability, RepeatMode, State, useProgress, Event, useTrackPlayerEvents } from 'react-native-track-player'
import * as FileSystem from 'expo-file-system'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { urlCover, urlStream } from '~/utils/url'
import { cacheCover, isSongCached, getPathSong, notifySongCacheChanged } from '~/utils/cache'
import { getApi } from '~/utils/api'
import {
	getCachedAlbum,
	getCachedArtist,
	getCachedSong,
	getServerId,
	saveCachedAudio,
} from '~/utils/cacheDatabase'
import MyState from '~/utils/playerState'
import logger from '~/utils/logger'

let isConnected = true

const initService = async () => {
	TrackPlayer.registerPlaybackService(() => require('~/services/servicePlayback'))
}

const convertState = (state) => {
	if (state === State.Playing) return MyState.Playing
	else if (state === State.Paused) return MyState.Paused
	else if (state === State.Stopped || state === State.None) return MyState.Stopped
	else if (state === State.Buffering) return MyState.Loading
	else if (state === State.Ready) return MyState.Paused
	else if (state === State.Error) return MyState.Error
	else return MyState.Stopped
}

const hydrateSavedSongCovers = async savedSong => {
	if (!savedSong?.queue?.length || !global.config) return savedSong
	const serverId = getServerId(global.config)
	const queue = await Promise.all(savedSong.queue.map(async track => {
		if (track.coverArt || !track.id) return track
		const cached = await getCachedSong(serverId, track.id)
		return {
			...track,
			coverArt: cached?.coverArt || track.coverArtId || track.covertArt,
		}
	}))
	return {
		...savedSong,
		queue,
		songInfo: queue[savedSong.index] || savedSong.songInfo,
	}
}

const reconcileActiveTrack = (savedSong, activeTrack, activeTrackIndex) => {
	if (!activeTrack) return savedSong
	const queue = savedSong?.queue?.length ? [...savedSong.queue] : [activeTrack]
	let index = queue.findIndex(track => track.id === activeTrack.id)

	if (index < 0 && activeTrackIndex != null && activeTrackIndex >= 0 && activeTrackIndex < queue.length) {
		index = activeTrackIndex
	} else if (index < 0) {
		return {
			...savedSong,
			queue: [activeTrack],
			index: 0,
			songInfo: activeTrack,
		}
	}

	queue[index] = {
		...queue[index],
		...activeTrack,
		coverArt: activeTrack.coverArt || queue[index].coverArt || queue[index].coverArtId,
	}
	return {
		...savedSong,
		queue,
		index,
		songInfo: queue[index],
	}
}

const initPlayer = async (songDispatch) => {
	global.songDispatch = songDispatch
	const savedSong = await AsyncStorage.getItem('song')
		.then((song) => song ? JSON.parse(song) : null)
	const cachedSong = await hydrateSavedSongCovers(savedSong)
	try {
		await TrackPlayer.setupPlayer()
	} catch (error) {
		if (error?.code === 'android_cannot_setup_player_in_background') return
	}
	songDispatch({ type: 'init' })
	await TrackPlayer.updateOptions({
		android: {
			appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
			alwaysPauseOnInterruption: true,
		},
		capabilities: [
			Capability.Play,
			Capability.Pause,
			Capability.SkipToNext,
			Capability.SkipToPrevious,
			Capability.SeekTo
		],
		notificationCapabilities: [
			Capability.Play,
			Capability.Pause,
			Capability.SkipToNext,
			Capability.SkipToPrevious,
			Capability.SeekTo
		],
		progressUpdateEventInterval: -1,
		icon: require('~/../assets/icon.png')
	})
	// Reconnect the new interface to the native player session, if it survived.
	const activeTrack = await TrackPlayer.getActiveTrack()
	const activeTrackIndex = await TrackPlayer.getActiveTrackIndex()
	const song = reconcileActiveTrack(cachedSong, activeTrack, activeTrackIndex)
	if (song) songDispatch({ type: 'restore', song, isSongLoad: activeTrack != null })
	TrackPlayer.setRepeatMode(RepeatMode.Off)
	const state = (await TrackPlayer.getPlaybackState()).state
	songDispatch({ type: 'setState', state: convertState(state) })
}

const useEvent = (song, songDispatch, _nextSong) => {
	// Catch player events
	useTrackPlayerEvents(
		[
			Event.PlaybackState,
			Event.PlaybackActiveTrackChanged,
		],
		async (event) => {
			if (!isConnected) return
			if (event.type === Event.PlaybackState) {
				songDispatch({ type: 'setState', state: convertState(event.state) })
			} else if (event.type === Event.PlaybackActiveTrackChanged) {
				if (global.song.index != undefined && song.index != global.song.index) {
					songDispatch({ type: 'setIndex', index: global.song.index })
				}
			}
		})
}

const reload = async () => {
	await TrackPlayer.retry()
}

const pauseSong = async () => {
	await TrackPlayer.pause()
}

const resumeSong = async () => {
	await TrackPlayer.play()
}

const stopSong = async () => {
	await TrackPlayer.stop()
}

const getHeader = (headers, key) => {
	if (!headers || !key) return null
	const header = Object.keys(headers).find(h => h.toLowerCase() === key.toLowerCase())
	return header ? headers[header] : null
}

const saveCoverIfNeeded = async (config, coverArtId, size) => {
	if (global.isCoverCaching === false || !coverArtId) return

	const filePath = await cacheCover(urlCover(config, coverArtId, size), coverArtId)
	if (!filePath) throw new Error(`Unable to cache cover ${coverArtId} at size ${size}`)
	const fileInfo = await FileSystem.getInfoAsync(filePath)
	if (!fileInfo.exists || !fileInfo.size) throw new Error(`Invalid cached cover ${coverArtId} at size ${size}`)
}

const continueCacheCascade = async (config, serverId, songId) => {
	let song = await getCachedSong(serverId, songId)
	if (!song) {
		const response = await getApi(config, 'getSong', { id: songId })
		song = response?.song
		if (!song) throw new Error(`Song ${songId} not found`)
	}

	let album = song.albumId ? await getCachedAlbum(serverId, song.albumId) : null
	if (song.albumId && !album) {
		const response = await getApi(config, 'getAlbum', { id: song.albumId })
			album = response?.album
			if (!album) throw new Error(`Album ${song.albumId} not found`)
	}

	const artistId = album?.artistId || song.artistId
	let artist = artistId ? await getCachedArtist(serverId, artistId) : null
	if (artistId && !artist) {
		const response = await getApi(config, 'getArtist', { id: artistId })
		artist = response?.artist
		if (!artist) throw new Error(`Artist ${artistId} not found`)
	}

	const requiredCoverSizes = new Map()
	const addCoverSizes = (coverArtId, sizes) => {
		if (!coverArtId) return
		if (!requiredCoverSizes.has(coverArtId)) requiredCoverSizes.set(coverArtId, new Set())
		sizes.forEach(size => requiredCoverSizes.get(coverArtId).add(size))
	}

	addCoverSizes(song.coverArt || song.coverArtId, [100, 500, 1000])
	addCoverSizes(album?.coverArt || album?.coverArtId, [100, 256, 500, 1000])
	addCoverSizes(artist?.coverArt || artist?.coverArtId, [100, 256, 1000])

	for (const [coverArtId, sizes] of requiredCoverSizes) {
		for (const size of sizes) await saveCoverIfNeeded(config, coverArtId, size)
	}
}

const registerCachedSong = async (song, fileUri, cacheKind) => {
	const fileInfo = await FileSystem.getInfoAsync(fileUri)
	if (!fileInfo.exists || !fileInfo.size) throw new Error(`Invalid cached song ${song.id}`)

	const serverId = await saveCachedAudio({
		config: global.config,
		song,
		format: global.streamFormat,
		maxBitRate: global.maxBitRate,
		fileSize: fileInfo.size,
		cacheKind,
	})

	notifySongCacheChanged(song.id)

	try {
		await continueCacheCascade(global.config, serverId, song.id)
	} catch (error) {
		if (error?.message !== 'Offline') logger.error('cacheCascade', error)
	}
}

const downloadSong = async (streamUrl, song, cacheKind = 'manual', _knownAlbum = null) => {
	if (global.isSongCaching === false) return streamUrl
	const id = song?.id
	if (!id || global.songsDownloading.indexOf(id) >= 0) return streamUrl
	const fileUri = getPathSong(id, global.streamFormat)
	const partUri = `${fileUri}.part`
	global.songsDownloading.push(id)

	try {
		if (await isSongCached(null, id, global.streamFormat, global.maxBitRate)) {
			await registerCachedSong(song, fileUri, cacheKind)
			return fileUri
		}

		const res = await FileSystem.downloadAsync(streamUrl, partUri)
		const contentType = getHeader(res?.headers, 'content-type')
		const contentLength = parseInt(getHeader(res?.headers, 'content-length'), 10)
		const realSize = await FileSystem.getInfoAsync(partUri).then(info => info.size)

		if (res?.status !== 200) {
			throw new Error(`Error downloading song, status not 200 (${res?.status})`)
		} else if (!contentType?.includes('audio')) {
			throw new Error(`Error downloading song, content-type not audio (${contentType})`)
		} else if ((!isNaN(contentLength) && realSize !== contentLength) || realSize === 0) {
			throw new Error(`Error downloading song, size mismatch (real: ${realSize} / content-length: ${contentLength})`)
		}

		await FileSystem.deleteAsync(fileUri, { idempotent: true })
		await FileSystem.moveAsync({ from: partUri, to: fileUri })
		await registerCachedSong(song, fileUri, cacheKind)
		return fileUri
	} catch (error) {
		logger.error('downloadSong', error)
		await FileSystem.deleteAsync(partUri, { idempotent: true }).catch(() => {})
		return streamUrl
	} finally {
		global.songsDownloading = global.songsDownloading.filter(songId => songId !== id)
	}
}
const downloadNextSong = async (queue, currentIndex) => {
	if (!global.isSongCaching) return
	if (!Array.isArray(queue) || queue.length === 0) return
	const songsToCache = Math.min(global.cacheNextSong + 1, queue.length)

	for (let offset = 0; offset < songsToCache; offset++) {
		const index = (currentIndex + offset) % queue.length
		if (!queue[index].isLiveStream && queue[index].id.match(/^[a-zA-Z0-9-]*$/)) {
			await downloadSong(urlStream(global.config, queue[index].id, global.streamFormat, global.maxBitRate), queue[index], 'automatic')
		}
	}
}

const convertToTrack = async (track, config) => {
	const useCachedAudio = global.isSongCaching !== false
		&& await isSongCached(null, track.id, global.streamFormat, global.maxBitRate)
	return {
		...track,
		id: track.id,
		url: useCachedAudio ?
			getPathSong(track.id, global.streamFormat) :
			urlStream(config, track.id, global.streamFormat, global.maxBitRate),
		artwork: urlCover(config, track, 500),
		artist: track.artist,
		title: track.title,
		album: track.album,
		description: '',
		date: '',
		genre: '',
		rating: false,
		duration: track.duration,
		type: 'default',
		isLiveStream: track.type === 'radio',
	}
}

const loadSong = async (config, queue, index) => {
	await TrackPlayer.load(await convertToTrack(queue[index], config))
	await TrackPlayer.play()
}

const setPosition = async (position) => {
	if (position < 0 || !position) position = 0
	if (position === Infinity) return

	await TrackPlayer.seekTo(position)
}

const setVolume = async (volume) => {
	if (volume > 1) volume = 1
	if (volume < 0) volume = 0
	await TrackPlayer.setVolume(volume)
}

const getVolume = () => {
	return TrackPlayer.getVolume()
}

const unloadSong = async () => { }
const tuktuktuk = async (songDispatch) => {
	const urlTuk = 'https://sawyerf.github.io/tuktuktuk.mp3'
	const playingState = await TrackPlayer.getPlaybackState()

	if ([State.Paused, State.Ended, State.Stopped, State.None, State.Error].indexOf(playingState.state) > -1) {
		const queue = [{
			id: 'tuktuktuk',
			albumId: 'tuktuktuk',
			url: urlTuk,
			title: 'Tuk Tuk Tuk',
			album: 'Tuk Tuk Tuk',
			artist: 'Sawyerf',
			artwork: require('~/../assets/icon.png')
		}]
		songDispatch({ type: 'setQueue', queue, index: 0 })
		songDispatch({ type: 'setActionEndOfSong', action: 'next' })
		await loadSong(global.config, queue, 0)
	}
}

const updateVolume = () => { }
const updateTime = () => {
	return useProgress(500)
}

const isVolumeSupported = () => {
	return false
}

const resetAudio = (songDispatch) => {
	songDispatch({ type: 'reset' })
	TrackPlayer.reset()
}

const saveState = async () => {
	const progress = await TrackPlayer.getProgress()
	const state = await TrackPlayer.getPlaybackState()
	return {
		position: progress.position || 0,
		isPlaying: state.state === State.Playing
	}
}

const connect = async (_device) => {
	isConnected = true
}

const disconnect = async (_device) => {
	await stopSong()
	isConnected = false
}

export default {
	initService,
	initPlayer,
	pauseSong,
	resumeSong,
	stopSong,
	setPosition,
	setVolume,
	getVolume,
	unloadSong,
	loadSong,
	tuktuktuk,
	updateVolume,
	updateTime,
	isVolumeSupported,
	reload,
	useEvent,
	resetAudio,
	saveState,
	downloadNextSong,
	downloadSong,
	connect,
	disconnect,
}
