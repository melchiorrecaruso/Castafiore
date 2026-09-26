import React from "react"

import { useConfig } from "~/contexts/config"
import { getJsonCache, getPlayableCachedSongs, searchPlayableCachedMedia, setJsonCache } from "~/utils/cache"
import { useUpdateApi, useSetUpdateApi, isUpdatable } from "~/contexts/updateApi"
import { useRefreshOnOffline, useRefreshOnReconnect } from '~/contexts/network'
import logger from "~/utils/logger"
import { NETWORK_OFFLINE, NETWORK_ONLINE, ensureNetworkState, getNetworkState, setNetworkState } from '~/utils/networkState'
import { getCachedGenreContent, getCachedNavidromeResponse, saveNavidromeLists } from '~/utils/navidromeLists'
import { catalogNavidromeResponse, getCachedStructuredResponse } from '~/utils/catalog'
import { filterOfflineResponse } from '~/utils/offlineMedia'

const STRUCTURED_PATHS = new Set(['getSong', 'getAlbum', 'getArtist', 'getArtistInfo'])
const JSON_CACHE_EXCLUDED_PATHS = new Set(['search3', 'getAlbumList2', 'getSongsByGenre', 'getRandomSongs'])

const storeJsonResponse = async (config, path, query, json) => {
	if (!JSON_CACHE_EXCLUDED_PATHS.has(path)) {
		await setJsonCache('api', getUrl(config, path, query), json)
	}
	return json
}

const getQueryValue = (query, name) => {
	if (query && typeof query === 'object') return query[name]
	return new URLSearchParams(query || '').get(name)
}

const getSearchPage = (items, query, prefix) => {
	const rawCount = getQueryValue(query, `${prefix}Count`)
	const rawOffset = getQueryValue(query, `${prefix}Offset`)
	const countValue = rawCount === null || rawCount === undefined || rawCount === '' ? NaN : Number(rawCount)
	const offsetValue = rawOffset === null || rawOffset === undefined || rawOffset === '' ? NaN : Number(rawOffset)
	const count = Number.isFinite(countValue) ? Math.max(0, countValue) : 20
	const offset = Number.isFinite(offsetValue) ? Math.max(0, offsetValue) : 0
	return items.slice(offset, offset + count)
}

const getOfflineSearchResponse = async query => {
	const result = await searchPlayableCachedMedia(getQueryValue(query, 'query'))
	return {
		searchResult3: {
			artist: getSearchPage(result.artist, query, 'artist'),
			album: getSearchPage(result.album, query, 'album'),
			song: getSearchPage(result.song, query, 'song'),
		},
	}
}

const getPositiveInteger = (query, name, defaultValue) => {
	const rawValue = getQueryValue(query, name)
	if (rawValue === null || rawValue === undefined || rawValue === '') return defaultValue
	const value = Number(rawValue)
	return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : defaultValue
}

const getPlayableGenreSongs = async (config, genre) => {
	const playableSongs = await getPlayableCachedSongs()
	if (!genre) return playableSongs
	const genreContent = await getCachedGenreContent(config, genre)
	const genreSongIds = new Set(genreContent.songs.map(song => String(song.id)))
	return playableSongs.filter(song => genreSongIds.has(String(song.id)))
}

const getOfflineSongsByGenreResponse = async (config, query) => {
	const songs = await getPlayableGenreSongs(config, getQueryValue(query, 'genre'))
	const offset = getPositiveInteger(query, 'offset', 0)
	const count = getPositiveInteger(query, 'count', 10)
	return { songsByGenre: { song: songs.slice(offset, offset + count) } }
}

const getOfflineAlbumsByGenreResponse = async (config, query) => {
	const content = await getCachedGenreContent(config, getQueryValue(query, 'genre'))
	const offset = getPositiveInteger(query, 'offset', 0)
	const size = getPositiveInteger(query, 'size', 10)
	return { albumList2: { album: content.albums.slice(offset, offset + size) } }
}

const getOfflineRandomSongsResponse = async (config, query) => {
	let songs = await getPlayableGenreSongs(config, getQueryValue(query, 'genre'))
	const fromYear = getPositiveInteger(query, 'fromYear', 0)
	const toYear = getPositiveInteger(query, 'toYear', Number.MAX_SAFE_INTEGER)
	if (fromYear || toYear !== Number.MAX_SAFE_INTEGER) {
		songs = songs.filter(song => song.year >= fromYear && song.year <= toYear)
	}
	const shuffled = [...songs]
	for (let index = shuffled.length - 1; index > 0; index -= 1) {
		const randomIndex = Math.floor(Math.random() * (index + 1))
		;[shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]]
	}
	const size = getPositiveInteger(query, 'size', 10)
	return { randomSongs: { song: shuffled.slice(0, size) } }
}

export const getUrl = (config, path, query = '') => {
	let encodedQuery = ''
	if (typeof query === 'string') {
		encodedQuery = query
	} else if (query === null || query === undefined) {
		encodedQuery = ''
	} else if (typeof query === 'object') {
		encodedQuery = Object.keys(query).map((key) => `${key}=${encodeURIComponent(query[key])}`).join('&')
	} else {
		logger.error('getUrl', 'query is not a string or an object')
		return ''
	}
	return `${config.url}/rest/${path}?${config.query}&f=json&${encodedQuery}`
}

export const getApi = (config, path, query = '') => {
	return new Promise((resolve, reject) => {
		if (!config?.url || !config?.query) {
			reject('getApi: config.url or config.query is not defined')
			return
		}
		fetch(getUrl(config, path, query))
			.then(res => {
				if (!res) return null
				setNetworkState(NETWORK_ONLINE)
				if (res.status !== 200) {
					reject({ message: `Connection failed (HTTP ${res.status})`, isApiError: false })
					return null
				} else {
					return res.json()
				}
			})
			.then(async json => {
				if (!json) {
					reject({ message: 'Connection failed (no response)', isApiError: false })
					return
				}
				if (json['subsonic-response'] && !json['subsonic-response']?.error) {
					const response = json['subsonic-response']
					await catalogNavidromeResponse(config, path, response, query)
						.catch(error => logger.error('catalogNavidromeResponse', error))
					await saveNavidromeLists(config, path, query, response)
						.catch(error => logger.error('saveNavidromeLists', error))
					resolve(response)
				} else {
					logger.error('getApi', `/rest/${path}: ${JSON.stringify(json['subsonic-response']?.error)}`)
					reject({ ...json['subsonic-response']?.error, isApiError: true })
				}
			})
			.catch((error) => {
				setNetworkState(NETWORK_OFFLINE)
				if (!/network request failed/i.test(String(error))) logger.error('getApi', `/rest/${path}: ${error}`)
				reject({ message: error.message, error, isApiError: false })
			})
	})
}

export const getCachedAndApi = async (config, path, query = '', setData = () => { }) => {
	if (!config?.url || !config?.query) {
		logger.error('getCachedAndApi', 'config.url or config.query is not defined')
		return
	}
	const networkStatus = await ensureNetworkState(config)
	if (networkStatus === NETWORK_OFFLINE) {
		const stored = await getStoredResponse(config, path, query).catch(() => null)
		setData(await filterOfflineResponse(stored), 'offline')
		return
	}

	if (STRUCTURED_PATHS.has(path)) {
		const cached = await getCachedStructuredResponse(config, path, query)
		if (cached?.isFresh) {
			const isOffline = getNetworkState() === NETWORK_OFFLINE
			setData(isOffline ? await filterOfflineResponse(cached.json) : cached.json, isOffline ? 'offline' : 'database')
			return
		}
		try {
			const response = await getApi(config, path, query)
			const updated = await getCachedStructuredResponse(config, path, query)
			setData(updated?.json || response, 'api')
		} catch {
			if (cached?.json) setData(await filterOfflineResponse(cached.json), 'offline')
		}
		return
	}

	try {
		const json = await getApi(config, path, query)
		await storeJsonResponse(config, path, query, json)
		setData(json, 'api')
	} catch {
		const cachedJson = await getStoredResponse(config, path, query).catch(() => null)
		setData(await filterOfflineResponse(cachedJson), 'offline')
	}
}

export const getStoredResponse = async (config, path, query = '') => {
	if (STRUCTURED_PATHS.has(path)) {
		return getCachedStructuredResponse(config, path, query).then(result => result?.json)
	}
	if (path === 'search3') return getOfflineSearchResponse(query)
	if (path === 'getAlbumList2' && getQueryValue(query, 'type') === 'byGenre') {
		return getOfflineAlbumsByGenreResponse(config, query)
	}
	if (path === 'getSongsByGenre') return getOfflineSongsByGenreResponse(config, query)
	if (path === 'getRandomSongs') return getOfflineRandomSongsResponse(config, query)
	const databaseResponse = await getCachedNavidromeResponse(config, path, query)
	if (databaseResponse) return databaseResponse
	return getJsonCache('api', getUrl(config, path, query))
}

export const getOfflineCachedResponse = async (config, path, query = '') => {
	const stored = await getStoredResponse(config, path, query).catch(() => null)
	return filterOfflineResponse(stored)
}

export const refreshApi = (config, path, query = '') => {
	return new Promise((resolve, reject) => {
		getApi(config, path, query)
			.then((json) => {
				storeJsonResponse(config, path, query, json).then(resolve)
			})
			.catch((error) => {
				logger.error('refreshApi', `/rest/${path}: `, error)
				reject({ ...error, isApiError: false })
			})
	})
}

// Keeps mounted consumers aligned with the authoritative stored response and
// refreshes them when connectivity or another API consumer changes the data.
export const useCachedAndApi = (initialState, path, query = '', setFunc = () => { }, deps = []) => {
	const config = useConfig()
	const updateApi = useUpdateApi()
	const setUpdateApi = useSetUpdateApi()
	const [data, setData] = React.useState(initialState)
	const uid = React.useRef(Date.now())

	const refresh = React.useCallback(() => {
		if (!config?.url || !config?.query) return
		uid.current = Date.now()
		refreshApi(config, path, query)
			.then((json) => {
				setUpdateApi({ path, query, uid: uid.current })
				setFunc(json, setData, 'api')
			})
	}, [config, path, query, setFunc, setUpdateApi])

	React.useEffect(() => {
		if (!config?.url || !config?.query) return
		getCachedAndApi(config, path, query, (json, mode) => {
			setFunc(json, setData, mode)
			if (mode === 'api') setUpdateApi({ path, query, uid: uid.current })
		})
	}, [config, ...deps])

	React.useEffect(() => {
		if (!config?.url || !config?.query) setData(initialState)
	}, [config])

	useRefreshOnReconnect(() => {
		if (!config?.url || !config?.query) return

		getCachedAndApi(config, path, query, (json, mode) => {
			setFunc(json, setData, mode)
			if (mode === 'api') setUpdateApi({ path, query, uid: uid.current })
		})
	})

	useRefreshOnOffline(() => {
		if (!config?.url || !config?.query) return
		getOfflineCachedResponse(config, path, query)
			.then(json => setFunc(json, setData, 'offline'))
	})

	React.useEffect(() => {
		if (!config?.url || !config?.query) return
		if (!isUpdatable(updateApi, path, query)) return
		if (updateApi.uid === uid.current) return

		const stored = getStoredResponse(config, path, query)
		stored
			.then((json) => {
				if (json) setFunc(json, setData, 'api')
			})
	}, [updateApi])

	return [data, refresh, setData]
}

export const useCachedFirst = (initialState, path, query = '', setFunc = () => { }, deps = []) => {
	const config = useConfig()
	const updateApi = useUpdateApi()
	const [data, setData] = React.useState(initialState)

	React.useEffect(() => {
		if (!config?.url || !config?.query) return
		getApiCacheFirst(config, path, query)
			.then((json) => {
				setFunc(json, setData)
			})
	}, [config, ...deps])

	useRefreshOnOffline(() => {
		if (!config?.url || !config?.query) return
		getOfflineCachedResponse(config, path, query)
			.then(json => setFunc(json, setData, 'offline'))
	})

	useRefreshOnReconnect(() => {
		if (!config?.url || !config?.query) return
		getApiCacheFirst(config, path, query).then(json => setFunc(json, setData, 'api'))
	})

	React.useEffect(() => {
		if (!config?.url || !config?.query) return
		if (!isUpdatable(updateApi, path, query)) return

		getStoredResponse(config, path, query)
			.then((json) => {
				if (json) setFunc(json, setData)
			})
	}, [updateApi])

	return [data, setData]
}

export const getApiCacheFirst = (config, path, query = '') => {
	return getApiNetworkFirst(config, path, query)
}

export const getApiNetworkFirst = (config, path, query = '', setMode = () => { }) => {
	return new Promise((resolve, reject) => {
		const getStored = () => getStoredResponse(config, path, query)
		const resolveCache = networkError => {
			getStored()
				.then(filterOfflineResponse)
				.then((json) => {
					if (json) {
						setMode('offline')
						resolve(json)
					} else reject(networkError)
				})
				.catch(error => reject(error))
		}
		const request = () => getCachedStructuredResponse(config, path, query)
			.then(async cached => {
				if (STRUCTURED_PATHS.has(path) && cached?.isFresh) {
					const isOffline = getNetworkState() === NETWORK_OFFLINE
					setMode(isOffline ? 'offline' : 'database')
					resolve(isOffline ? await filterOfflineResponse(cached.json) : cached.json)
					return null
				}
				return getApi(config, path, query)
			})
			.then((json) => {
				if (!json) return
				setMode('api')
				const stored = STRUCTURED_PATHS.has(path)
					? getCachedStructuredResponse(config, path, query).then(result => result?.json || json)
					: storeJsonResponse(config, path, query, json)
				stored.then(resolve)
					.catch(() => {
						resolve(json)
					})
				})
				.catch(resolveCache)

		ensureNetworkState(config)
			.then(status => {
				if (status === NETWORK_OFFLINE) {
					resolveCache({ message: 'Server offline', isApiError: false })
					return
				}
				request()
			})
			.catch(resolveCache)
	})
}
