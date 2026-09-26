import { getPlayableCachedSongs } from '~/utils/cache'

const filterItems = (items, ids) => (items || []).filter(item => item?.id && ids.has(String(item.id)))

export const filterOfflineResponse = async response => {
	if (!response) return response
	const songs = await getPlayableCachedSongs()
	const songIds = new Set(songs.map(song => String(song.id)))
	const albumIds = new Set(songs.map(song => song.albumId).filter(Boolean).map(String))
	const artistIds = new Set(songs.flatMap(song => [
		song.artistId,
		...(song.artists || []).map(artist => artist.id),
		...(song.albumArtists || []).map(artist => artist.id),
	]).filter(Boolean).map(String))
	const result = { ...response }

	if ('song' in result) result.song = result.song?.id && songIds.has(String(result.song.id)) ? result.song : null
	if (result.album) {
		if (albumIds.has(String(result.album.id))) {
			const albumSongs = filterItems(result.album.song, songIds)
			result.album = {
				...result.album,
				song: albumSongs,
				songCount: albumSongs.length,
				duration: albumSongs.reduce((total, song) => total + (song.duration || 0), 0),
			}
		} else result.album = null
	}
	if (result.artist) {
		if (artistIds.has(String(result.artist.id))) {
			const artistAlbums = filterItems(result.artist.album, albumIds)
			result.artist = { ...result.artist, album: artistAlbums, albumCount: artistAlbums.length }
		} else result.artist = null
	}
	if (result.artistInfo) {
		const artistId = result.artistInfo.id || result.artistInfo.artistId
		result.artistInfo = artistIds.has(String(artistId)) ? {
			...result.artistInfo,
			similarArtist: filterItems(result.artistInfo.similarArtist, artistIds),
		} : null
	}
	if (result.searchResult3) result.searchResult3 = {
		...result.searchResult3,
		song: filterItems(result.searchResult3.song, songIds),
		album: filterItems(result.searchResult3.album, albumIds),
		artist: filterItems(result.searchResult3.artist, artistIds),
	}
	if (result.starred2) result.starred2 = {
		...result.starred2,
		song: filterItems(result.starred2.song, songIds),
		album: filterItems(result.starred2.album, albumIds),
		artist: filterItems(result.starred2.artist, artistIds),
	}
	if (result.playlist) {
		const entries = filterItems(result.playlist.entry, songIds)
		result.playlist = {
			...result.playlist,
			entry: entries,
			songCount: entries.length,
			duration: entries.reduce((total, song) => total + (song.duration || 0), 0),
		}
	}
	if (result.topSongs) result.topSongs = { ...result.topSongs, song: filterItems(result.topSongs.song, songIds) }
	if (result.similarSongs) result.similarSongs = { ...result.similarSongs, song: filterItems(result.similarSongs.song, songIds) }
	if (result.randomSongs) result.randomSongs = { ...result.randomSongs, song: filterItems(result.randomSongs.song, songIds) }
	if (result.songsByGenre) result.songsByGenre = { ...result.songsByGenre, song: filterItems(result.songsByGenre.song, songIds) }
	if (result.albumList2) result.albumList2 = { ...result.albumList2, album: filterItems(result.albumList2.album, albumIds) }
	if (result.artists?.index) result.artists = {
		...result.artists,
		index: result.artists.index
			.map(group => ({ ...group, artist: filterItems(group.artist, artistIds) }))
			.filter(group => group.artist.length),
	}

	return result
}
