import { urlStream } from '~/utils/url'

export const subscribeSongCacheChanged = (_callback) => ({ remove: () => { } })

export const getCache = async (cacheName, key) => {
	const caches = await window.caches.open(cacheName)
	if (!caches) return null
	return await caches.match(key)
}

export const clearCache = async () => {
	await Promise.all(['api', 'lyrics', 'apiLongResponse'].map(key => window.caches.delete(key)))
}

export const clearSongCache = async () => {
	await window.caches.delete('song')
}

export const clearCoverCache = async () => {
	await Promise.all(['coverArt', 'images'].map(key => window.caches.delete(key)))
}

const getCachesStat = async names => {
	let count = 0
	let size = 0
	const existingNames = await window.caches.keys()
	for (const name of names) {
		if (!existingNames.includes(name)) continue
		const cache = await window.caches.open(name)
		const requests = await cache.keys()
		count += requests.length
		const responses = await Promise.all(requests.map(request => cache.match(request)))
		const sizes = await Promise.all(responses.filter(Boolean).map(async response => {
			const contentLength = Number(response.headers.get('content-length'))
			return Number.isFinite(contentLength) && contentLength >= 0
				? contentLength
				: (await response.clone().blob()).size
		}))
		size += sizes.reduce((total, value) => total + value, 0)
	}
	return { count, size }
}

const formatBytes = bytes => {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export const getStatCache = async () => {
	const [api, songs, covers] = await Promise.all([
		getCachesStat(['api', 'lyrics', 'apiLongResponse']),
		getCachesStat(['song']),
		getCachesStat(['coverArt', 'images']),
	])
	return [
		{ name: 'Cache Api', count: api.count },
		{ name: 'Cache Api Size', count: formatBytes(api.size) },
		{ name: 'Cache Songs', count: songs.count },
		{ name: 'Cache Songs Size', count: formatBytes(songs.size) },
		{ name: 'Cache Covers', count: covers.count },
		{ name: 'Cache Covers Size', count: formatBytes(covers.size) },
	]
}

export const getJsonCache = async (cacheName, url) => {
	const cache = await getCache(cacheName, url)
	if (!cache) return null
	const json = await cache.json()
	if (!json) return null
	return json['subsonic-response']
}

export const setJsonCache = async (_cacheName, _key, _json) => {
	// Service worker already do this
}

export const isSongCached = async (config, songId, streamFormat, maxBitRate) => {
	return getCache('song', urlStream(config, songId, streamFormat, maxBitRate))
}

export const getSongCachedInfo = async (config, songId, streamFormat, maxBitRate) => {
	const cache = await getCache('song', urlStream(config, songId, streamFormat, maxBitRate))
	if (!cache) return null
	return [
		{ title: 'Is cached', value: 'Yes' },
		{ title: 'Size', value: `${(cache.headers.get('content-length') / (1024 * 1024)).toFixed(2)} MB` },
	]
}

export const deleteSongCache = async (config, songId, streamFormat, maxBitRate) => {
	const url = urlStream(config, songId, streamFormat, maxBitRate)

	await window.caches.open('song')
		.then(cache => cache.delete(url))
}

export const getListCacheSong = async () => {
	return []
}

export const getPathSong = (_songId, _streamFormat) => {
	return null
}

export const initCacheSong = async () => {
}

export const getPlayableCachedAlbums = async () => []
export const getPlayableCachedSongs = async () => []
export const getPlayableCachedArtists = async () => []
export const searchPlayableCachedMedia = async () => ({ album: [], artist: [], song: [] })
