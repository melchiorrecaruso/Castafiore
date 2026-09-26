import { getDatabase, runDatabaseWrite } from '~/utils/database'
import { getCachedSong, getServerId } from '~/utils/cacheDatabase'


const listDefinitions = {
	'favorited-artist': { table: 'favoritedArtists', idColumn: 'artistId' },
	'favorited-album-star': { table: 'favoritedAlbums', idColumn: 'albumId' },
	'favorited-song': { table: 'favoritedSongs', idColumn: 'songId' },
	'artist-top-songs': { table: 'artistTopSongs', idColumn: 'songId', scopeColumn: 'artistName' },
	'similar-songs': { table: 'similarSongs', idColumn: 'songId', scopeColumn: 'sourceId' },
	genre: { table: 'genres', idColumn: 'genreId' },
	'pin-playlist': { table: 'pinnedPlaylists', idColumn: 'playlistId' },
	'recently-added': { table: 'recentlyAdded', idColumn: 'albumId' },
	'most-played': { table: 'mostPlayed', idColumn: 'albumId' },
	'recently-played': { table: 'recentlyPlayed', idColumn: 'albumId' },
	'random-album': { table: 'randomAlbums', idColumn: 'albumId' },
	'highest-album': { table: 'highestAlbums', idColumn: 'albumId' },
}

let listWriteQueue = Promise.resolve()

const getQueryValue = (query, name) => {
	if (query && typeof query === 'object') return query[name]
	return new URLSearchParams(query || '').get(name)
}

const getReceivedLists = (config, path, query, json) => {
	if (path === 'getStarred2') {
		return [
			{ id: 'favorited-artist', items: json?.starred2?.artist || [], getId: item => item.id },
			{ id: 'favorited-album-star', items: json?.starred2?.album || [], getId: item => item.id },
			{ id: 'favorited-song', items: json?.starred2?.song || [], getId: item => item.id },
		]
	}
	if (path === 'getTopSongs') {
		return [{
			id: 'artist-top-songs',
			scope: String(getQueryValue(query, 'artist') || '').trim().toLocaleLowerCase(),
			items: json?.topSongs?.song || [],
			getId: item => item.id,
		}]
	}
	if (path === 'getSimilarSongs') {
		return [{
			id: 'similar-songs',
			scope: String(getQueryValue(query, 'id') || ''),
			items: json?.similarSongs?.song || [],
			getId: item => item.id,
		}]
	}
	if (path === 'getGenres') {
		return [{ id: 'genre', items: json?.genres?.genre || [], getId: item => item.value }]
	}
	if (path === 'getPlaylists') {
		const pin = `#${config.username}-pin`
		const playlists = (json?.playlists?.playlist || []).filter(playlist => playlist.comment?.includes(pin))
		return [{ id: 'pin-playlist', items: playlists, getId: item => item.id }]
	}
	if (path !== 'getAlbumList2') return []

	const listId = {
		newest: 'recently-added',
		frequent: 'most-played',
		recent: 'recently-played',
		random: 'random-album',
		highest: 'highest-album',
	}[getQueryValue(query, 'type')]
	return listId ? [{ id: listId, items: json?.albumList2?.album || [], getId: item => item.id }] : []
}

const replaceList = async (serverId, listId, items, getId, scope = null) => {
	const definition = listDefinitions[listId]
	if (!definition) return
	if (definition.scopeColumn && !scope) return
	const rows = items
		.map((item, position) => ({ itemId: getId(item), position }))
		.filter(row => row.itemId !== null && row.itemId !== undefined && row.itemId !== '')
	await runDatabaseWrite(`replace-list:${listId}`, database => database.withExclusiveTransactionAsync(async transaction => {
		const scopeFilter = definition.scopeColumn ? ` AND ${definition.scopeColumn} = ?` : ''
		await transaction.runAsync(
			`DELETE FROM ${definition.table} WHERE serverId = ?${scopeFilter}`,
			...[serverId, ...(definition.scopeColumn ? [scope] : [])],
		)
		for (const row of rows) {
			const columns = definition.scopeColumn
				? `serverId, ${definition.scopeColumn}, ${definition.idColumn}, position`
				: `serverId, ${definition.idColumn}, position`
			const values = definition.scopeColumn
				? [serverId, scope, String(row.itemId), row.position]
				: [serverId, String(row.itemId), row.position]
			await transaction.runAsync(
				`INSERT INTO ${definition.table} (${columns}) VALUES (${values.map(() => '?').join(', ')})`,
				...values,
			)
		}
	}))
}

const upsertPlaylist = (database, serverId, playlist, updatedAt) => {
	if (!playlist?.id || !playlist?.name) return Promise.resolve()
	return database.runAsync(`
		INSERT INTO playlists (
			serverId, playlistId, name, comment, owner, public, songCount,
			duration, created, changed, coverArtId, updatedAt
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (serverId, playlistId) DO UPDATE SET
			name = excluded.name,
			comment = excluded.comment,
			owner = excluded.owner,
			public = excluded.public,
			songCount = excluded.songCount,
			duration = excluded.duration,
			created = excluded.created,
			changed = excluded.changed,
			coverArtId = excluded.coverArtId,
			updatedAt = excluded.updatedAt
	`, serverId, playlist.id, playlist.name, playlist.comment || null,
	playlist.owner || null, playlist.public == null ? null : Number(playlist.public),
	playlist.songCount ?? null, playlist.duration ?? null, playlist.created || null,
	playlist.changed || null, playlist.coverArt || null, updatedAt)
}

const savePlaylistData = async (config, path, json) => {
	if (path !== 'getPlaylists' && path !== 'getPlaylist') return
	const serverId = getServerId(config)
	const updatedAt = Date.now()
	await runDatabaseWrite(`save-playlist:${path}`, database => database.withExclusiveTransactionAsync(async transaction => {
		if (path === 'getPlaylists') {
			const playlists = json?.playlists?.playlist || []
			const receivedIds = new Set(playlists.map(playlist => String(playlist.id)))
			const stored = await transaction.getAllAsync(
				'SELECT playlistId FROM playlists WHERE serverId = ?', serverId,
			)
			for (const row of stored) {
				if (receivedIds.has(String(row.playlistId))) continue
				await transaction.runAsync(
					'DELETE FROM playlistSongs WHERE serverId = ? AND playlistId = ?',
					serverId, row.playlistId,
				)
			}
			await transaction.runAsync('DELETE FROM playlists WHERE serverId = ?', serverId)
			for (const playlist of playlists) await upsertPlaylist(transaction, serverId, playlist, updatedAt)
			return
		}

		const playlist = json?.playlist
		if (!playlist?.id) return
		await upsertPlaylist(transaction, serverId, playlist, updatedAt)
		if (!Array.isArray(playlist.entry)) return
		await transaction.runAsync(
			'DELETE FROM playlistSongs WHERE serverId = ? AND playlistId = ?',
			serverId, playlist.id,
		)
		for (const [position, song] of playlist.entry.entries()) {
			if (!song?.id) continue
			await transaction.runAsync(`
				INSERT INTO playlistSongs (serverId, playlistId, songId, position)
				VALUES (?, ?, ?, ?)
			`, serverId, playlist.id, song.id, position)
		}
	}))
}

const saveRadioData = async (config, path, json) => {
	if (path !== 'getInternetRadioStations') return
	const serverId = getServerId(config)
	const updatedAt = Date.now()
	const stations = json?.internetRadioStations?.internetRadioStation || []
	await runDatabaseWrite('save-radio-stations', database => database.withExclusiveTransactionAsync(async transaction => {
		await transaction.runAsync('DELETE FROM radios WHERE serverId = ?', serverId)
		await transaction.runAsync('DELETE FROM radioStations WHERE serverId = ?', serverId)
		for (const [position, station] of stations.entries()) {
			if (!station?.id || !station?.name || !station?.streamUrl) continue
			await transaction.runAsync(`
				INSERT INTO radioStations (
					serverId, radioId, name, streamUrl, homePageUrl, updatedAt
				) VALUES (?, ?, ?, ?, ?, ?)
			`, serverId, station.id, station.name, station.streamUrl,
			station.homePageUrl || null, updatedAt)
			await transaction.runAsync(`
				INSERT INTO radios (serverId, radioId, position)
				VALUES (?, ?, ?)
			`, serverId, station.id, position)
		}
	}))
}

const savePlayQueueData = async (config, path, json) => {
	if (path !== 'getPlayQueue' || !json?.playQueue) return
	const serverId = getServerId(config)
	const queue = json.playQueue
	const updatedAt = Date.now()
	await runDatabaseWrite('save-play-queue', database => database.withExclusiveTransactionAsync(async transaction => {
		await transaction.runAsync('DELETE FROM lastQueue WHERE serverId = ?', serverId)
		for (const [position, song] of (queue.entry || []).entries()) {
			if (!song?.id) continue
			await transaction.runAsync(`
				INSERT INTO lastQueue (serverId, songId, position)
				VALUES (?, ?, ?)
			`, serverId, song.id, position)
		}
		await transaction.runAsync(`
			INSERT INTO playQueueState (
				serverId, currentSongId, currentPosition, username,
				changed, changedBy, updatedAt
			) VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (serverId) DO UPDATE SET
				currentSongId = excluded.currentSongId,
				currentPosition = excluded.currentPosition,
				username = excluded.username,
				changed = excluded.changed,
				changedBy = excluded.changedBy,
				updatedAt = excluded.updatedAt
		`, serverId, queue.current || null, queue.position ?? null,
		queue.username || null, queue.changed || null, queue.changedBy || null, updatedAt)
	}))
}

export const saveNavidromeLists = (config, path, query, json) => {
	const save = async () => {
		await savePlaylistData(config, path, json)
		await saveRadioData(config, path, json)
		await savePlayQueueData(config, path, json)
		const receivedLists = getReceivedLists(config, path, query, json)
		if (!receivedLists.length) return
		const serverId = getServerId(config)
		for (const list of receivedLists) {
			await replaceList(serverId, list.id, list.items, list.getId, list.scope)
		}
	}

	const result = listWriteQueue.then(save)
	listWriteQueue = result.catch(() => {})
	return result
}

export const getCachedNavidromeList = async (config, listId, { playableOnly = true } = {}) => {
	const serverId = getServerId(config)
	const database = await getDatabase()
	const playableAlbumFilter = playableOnly ? `
				AND EXISTS (
					SELECT 1 FROM songs
					JOIN cacheAudio ON cacheAudio.serverId = songs.serverId AND cacheAudio.songId = songs.songId
					WHERE songs.serverId = albums.serverId AND songs.albumId = albums.albumId
				)` : ''
	const playableArtistFilter = playableOnly ? `
				AND EXISTS (
					SELECT 1 FROM songs
					JOIN cacheAudio ON cacheAudio.serverId = songs.serverId AND cacheAudio.songId = songs.songId
					WHERE songs.serverId = artists.serverId AND songs.artistId = artists.artistId
				)` : ''

	if (['recently-added', 'most-played', 'recently-played', 'random-album', 'highest-album', 'favorited-album-star'].includes(listId)) {
		const definition = listDefinitions[listId]
		return database.getAllAsync(`
			SELECT albums.albumId AS id, albums.name, albums.name AS album,
				albums.artistId, COALESCE(albums.artist, artists.name) AS artist,
				albums.coverArtId AS coverArt, albums.year, albums.songCount, albums.duration,
				albums.starred, albums.userRating, albums.averageRating,
				albums.playCount, albums.played, albums.created
			FROM ${definition.table} AS list
			JOIN albums ON albums.serverId = list.serverId AND albums.albumId = list.albumId
			LEFT JOIN artists ON artists.serverId = albums.serverId AND artists.artistId = albums.artistId
			WHERE list.serverId = ?
				${playableAlbumFilter}
			ORDER BY list.position
		`, serverId)
	}

	if (listId === 'favorited-artist') {
		return database.getAllAsync(`
			SELECT artists.artistId AS id, artists.name, artists.sortName,
				artists.coverArtId AS coverArt, artistDetails.albumCount,
				artistDetails.artistImageUrl, artistDetails.starred,
				artistDetails.userRating
			FROM favoritedArtists AS list
			JOIN artists ON artists.serverId = list.serverId AND artists.artistId = list.artistId
			LEFT JOIN artistDetails ON artistDetails.serverId = artists.serverId
				AND artistDetails.artistId = artists.artistId
			WHERE list.serverId = ?
				${playableArtistFilter}
			ORDER BY list.position
		`, serverId)
	}

	if (listId === 'last-queue') {
		return database.getAllAsync(`
			SELECT songs.songId AS id, songs.title, songs.albumId, songs.artistId,
				COALESCE(songs.album, albums.name) AS album,
				COALESCE(songs.artist, artists.name) AS artist, songs.coverArtId AS coverArt,
				songs.track, songs.discNumber, songs.duration, songs.year, songs.genre,
				songs.starred, songs.userRating, songs.averageRating, songs.playCount, songs.played
			FROM lastQueue AS list
			JOIN songs ON songs.serverId = list.serverId AND songs.songId = list.songId
			${playableOnly ? 'JOIN cacheAudio ON cacheAudio.serverId = songs.serverId AND cacheAudio.songId = songs.songId' : ''}
			LEFT JOIN albums ON albums.serverId = songs.serverId AND albums.albumId = songs.albumId
			LEFT JOIN artists ON artists.serverId = songs.serverId AND artists.artistId = songs.artistId
			WHERE list.serverId = ?
			GROUP BY songs.serverId, songs.songId
			ORDER BY list.position
		`, serverId)
	}

	if (listId === 'favorited-song') {
		return getCachedSongList(config, 'favoritedSongs')
	}

	if (listId === 'pin-playlist') {
		return database.getAllAsync(`
			SELECT playlists.playlistId AS id, playlists.name, playlists.comment,
				playlists.owner, playlists.public, playlists.songCount,
				playlists.duration, playlists.created, playlists.changed,
				playlists.coverArtId AS coverArt
			FROM pinnedPlaylists AS list
			JOIN playlists ON playlists.serverId = list.serverId
				AND playlists.playlistId = list.playlistId
			WHERE list.serverId = ?
			ORDER BY list.position
		`, serverId)
	}

	if (listId === 'genre') {
		return database.getAllAsync(`
			SELECT list.genreId AS value,
				COUNT(DISTINCT ${playableOnly ? 'CASE WHEN cacheAudio.songId IS NOT NULL THEN songs.songId END' : 'songs.songId'}) AS songCount,
				COUNT(DISTINCT ${playableOnly ? 'CASE WHEN cacheAudio.songId IS NOT NULL THEN songs.albumId END' : 'songs.albumId'}) AS albumCount
			FROM genres AS list
			LEFT JOIN songGenres ON songGenres.serverId = list.serverId AND songGenres.genreId = list.genreId
			LEFT JOIN songs ON songs.serverId = songGenres.serverId AND songs.songId = songGenres.songId
			${playableOnly ? 'LEFT JOIN cacheAudio ON cacheAudio.serverId = songs.serverId AND cacheAudio.songId = songs.songId' : ''}
			WHERE list.serverId = ?
			GROUP BY list.serverId, list.genreId, list.position
			${playableOnly ? 'HAVING COUNT(cacheAudio.songId) > 0' : ''}
			ORDER BY list.position
		`, serverId)
	}

	if (listId === 'radio') {
		return database.getAllAsync(`
			SELECT radioStations.radioId AS id, radioStations.name,
				radioStations.streamUrl, radioStations.homePageUrl
			FROM radios AS list
			JOIN radioStations ON radioStations.serverId = list.serverId
				AND radioStations.radioId = list.radioId
			WHERE list.serverId = ?
			ORDER BY list.position
		`, serverId)
	}

	return null
}

const getCachedSongList = async (config, table, scopeColumn = null, scope = null) => {
	const serverId = getServerId(config)
	const database = await getDatabase()
	const scopeFilter = scopeColumn ? ` AND ${scopeColumn} = ?` : ''
	const rows = await database.getAllAsync(
		`SELECT songId FROM ${table} WHERE serverId = ?${scopeFilter} ORDER BY position`,
		...[serverId, ...(scopeColumn ? [scope] : [])],
	)
	return (await Promise.all(rows.map(row => getCachedSong(serverId, row.songId)))).filter(Boolean)
}

export const getCachedNavidromeResponse = async (config, path, query = '') => {
	if (path === 'getPlayQueue') {
		const entry = await getCachedNavidromeList(config, 'last-queue')
		const serverId = getServerId(config)
		const database = await getDatabase()
		const state = await database.getFirstAsync(`
			SELECT currentSongId AS current, currentPosition AS position,
				username, changed, changedBy
			FROM playQueueState
			WHERE serverId = ?
		`, serverId)
		return { playQueue: { ...(state || {}), entry: entry || [] } }
	}
	if (path === 'getGenres') {
		const genre = await getCachedNavidromeList(config, 'genre')
		return { genres: { genre: genre || [] } }
	}
	if (path === 'getAlbumList2') {
		const listId = {
			newest: 'recently-added',
			frequent: 'most-played',
			recent: 'recently-played',
			random: 'random-album',
			highest: 'highest-album',
		}[getQueryValue(query, 'type')]
		if (!listId) return null
		const album = await getCachedNavidromeList(config, listId)
		return { albumList2: { album: album || [] } }
	}
	if (path === 'getInternetRadioStations') {
		const internetRadioStation = await getCachedNavidromeList(config, 'radio')
		return { internetRadioStations: { internetRadioStation } }
	}
	if (path === 'getPlaylists') {
		const serverId = getServerId(config)
		const database = await getDatabase()
		const playlist = await database.getAllAsync(`
			SELECT playlistId AS id, name, comment, owner, public, songCount,
				duration, created, changed, coverArtId AS coverArt
			FROM playlists
			WHERE serverId = ?
			ORDER BY name
		`, serverId)
		return { playlists: { playlist } }
	}
	if (path === 'getPlaylist') {
		const playlistId = String(getQueryValue(query, 'id') || '')
		if (!playlistId) return null
		const serverId = getServerId(config)
		const database = await getDatabase()
		const playlist = await database.getFirstAsync(`
			SELECT playlistId AS id, name, comment, owner, public, songCount,
				duration, created, changed, coverArtId AS coverArt
			FROM playlists
			WHERE serverId = ? AND playlistId = ?
		`, serverId, playlistId)
		if (!playlist) return null
		const rows = await database.getAllAsync(`
			SELECT songId, position FROM playlistSongs
			WHERE serverId = ? AND playlistId = ?
			ORDER BY position
		`, serverId, playlistId)
		playlist.entry = (await Promise.all(
			rows.map(row => getCachedSong(serverId, row.songId)),
		)).filter(Boolean)
		return { playlist }
	}
	if (path === 'getStarred2') {
		const [artist, album, song] = await Promise.all([
			getCachedNavidromeList(config, 'favorited-artist'),
			getCachedNavidromeList(config, 'favorited-album-star'),
			getCachedNavidromeList(config, 'favorited-song'),
		])
		return { starred2: { artist: artist || [], album: album || [], song: song || [] } }
	}
	if (path === 'getTopSongs') {
		const artistName = String(getQueryValue(query, 'artist') || '').trim().toLocaleLowerCase()
		const song = artistName
			? await getCachedSongList(config, 'artistTopSongs', 'artistName', artistName)
			: []
		return { topSongs: { song } }
	}
	if (path === 'getSimilarSongs') {
		const sourceId = String(getQueryValue(query, 'id') || '')
		const song = sourceId
			? await getCachedSongList(config, 'similarSongs', 'sourceId', sourceId)
			: []
		return { similarSongs: { song } }
	}
	return null
}

export const getCachedGenreContent = async (config, genreId) => {
	const serverId = getServerId(config)
	const database = await getDatabase()
	const songs = await database.getAllAsync(`
		SELECT songs.songId AS id, songs.title, songs.albumId, songs.artistId,
			COALESCE(songs.album, albums.name) AS album,
			COALESCE(songs.artist, artists.name) AS artist, songs.coverArtId AS coverArt,
			songs.track, songs.discNumber, songs.duration, songs.year, songs.genre,
			songs.starred, songs.userRating, songs.averageRating, songs.playCount, songs.played
		FROM songGenres
		JOIN songs ON songs.serverId = songGenres.serverId AND songs.songId = songGenres.songId
		JOIN cacheAudio ON cacheAudio.serverId = songs.serverId AND cacheAudio.songId = songs.songId
		LEFT JOIN albums ON albums.serverId = songs.serverId AND albums.albumId = songs.albumId
		LEFT JOIN artists ON artists.serverId = songs.serverId AND artists.artistId = songs.artistId
		WHERE songGenres.serverId = ? AND songGenres.genreId = ?
		GROUP BY songs.serverId, songs.songId
		ORDER BY songs.albumId, songs.discNumber, songs.track
	`, serverId, genreId)
	const albums = await database.getAllAsync(`
		SELECT albums.albumId AS id, albums.name, albums.name AS album,
			albums.artistId, COALESCE(albums.artist, artists.name) AS artist,
			albums.coverArtId AS coverArt, albums.year, albums.songCount, albums.duration,
			albums.starred, albums.userRating, albums.averageRating,
			albums.playCount, albums.played, albums.created
		FROM albums
		LEFT JOIN artists ON artists.serverId = albums.serverId AND artists.artistId = albums.artistId
		WHERE albums.serverId = ?
			AND EXISTS (
				SELECT 1 FROM songs AS cachedSong
				JOIN cacheAudio ON cacheAudio.serverId = cachedSong.serverId AND cacheAudio.songId = cachedSong.songId
				WHERE cachedSong.serverId = albums.serverId AND cachedSong.albumId = albums.albumId
			)
			AND (
				EXISTS (SELECT 1 FROM albumGenres WHERE albumGenres.serverId = albums.serverId AND albumGenres.albumId = albums.albumId AND albumGenres.genreId = ?)
				OR EXISTS (
					SELECT 1 FROM songs AS genreSong
					JOIN songGenres ON songGenres.serverId = genreSong.serverId AND songGenres.songId = genreSong.songId
					WHERE genreSong.serverId = albums.serverId AND genreSong.albumId = albums.albumId AND songGenres.genreId = ?
				)
			)
		ORDER BY albums.name
	`, serverId, genreId, genreId)
	const artists = await database.getAllAsync(`
		SELECT artists.artistId AS id, artists.name, artists.coverArtId AS coverArt
		FROM artistGenres
		JOIN artists ON artists.serverId = artistGenres.serverId AND artists.artistId = artistGenres.artistId
		WHERE artistGenres.serverId = ? AND artistGenres.genreId = ?
			AND EXISTS (
				SELECT 1 FROM songs
				JOIN cacheAudio ON cacheAudio.serverId = songs.serverId AND cacheAudio.songId = songs.songId
				WHERE songs.serverId = artists.serverId AND songs.artistId = artists.artistId
			)
		ORDER BY artists.name
	`, serverId, genreId)

	return { albums, artists, songs }
}
