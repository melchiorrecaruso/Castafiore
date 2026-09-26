import {
	getCachedStructuredResponse,
	saveArtistInfo,
	saveArtistReferences,
	saveCatalogItems,
} from '~/utils/cacheDatabase'

export { getCachedStructuredResponse }


const getQueryValue = (query, name) => {
	if (query && typeof query === 'object') return query[name]
	return new URLSearchParams(query || '').get(name)
}

export const catalogNavidromeResponse = async (config, path, response, query = '') => {
	if (path === 'getArtists') {
		const artists = (response?.artists?.index || [])
			.flatMap(group => Array.isArray(group?.artist) ? group.artist : [])
		await saveArtistReferences(config, artists)
		return
	}
	if (path === 'getArtistInfo') {
		const artistId = getQueryValue(query, 'id')
		if (artistId && response?.artistInfo) await saveArtistInfo(config, artistId, response.artistInfo)
		return
	}
	if (path === 'getSong') {
		const song = response?.song
		if (song?.id) await saveCatalogItems(config, {
			songs: [song],
		})
		return
	}
	if (path === 'getAlbum') {
		const album = response?.album
		if (album?.id) await saveCatalogItems(config, {
			albums: [album],
			songs: Array.isArray(album.song) ? album.song : [],
		})
		return
	}
	if (path === 'getArtist') {
		const artist = response?.artist
		if (artist?.id) await saveCatalogItems(config, {
			artists: [artist],
			albums: Array.isArray(artist.album) ? artist.album : [],
			detailedArtistIds: [artist.id],
		})
	}
}
