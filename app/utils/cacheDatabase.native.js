import { getDatabase, runDatabaseWrite } from '~/utils/database'
import { getServerId } from '~/utils/serverIdentity'

export { getServerId } from '~/utils/serverIdentity'


export const CATALOG_MAX_AGE = 2 * 24 * 60 * 60 * 1000

const getQueryValue = (query, name) => {
	if (query && typeof query === 'object') return query[name]
	return new URLSearchParams(query || '').get(name)
}

const getGenreNames = item => {
	if (typeof item?.genre !== 'string' && !Array.isArray(item?.genres)) return null
	const genres = []
	if (typeof item?.genre === 'string') genres.push(item.genre)
	if (Array.isArray(item?.genres)) {
		item.genres.forEach(genre => {
			const name = typeof genre === 'string' ? genre : genre?.name || genre?.value
			if (name) genres.push(name)
		})
	}
	return [...new Set(genres.map(name => name.trim()).filter(Boolean))]
}

const rebuildArtistGenres = async (database, serverId, artistId) => {
	if (!artistId) return
	await database.runAsync(
		'DELETE FROM artistGenres WHERE serverId = ? AND artistId = ?',
		serverId,
		artistId,
	)
	await database.runAsync(`
		INSERT OR IGNORE INTO artistGenres (serverId, artistId, genreId)
		SELECT songs.serverId, songs.artistId, songGenres.genreId
		FROM songs
		JOIN songGenres ON songGenres.serverId = songs.serverId AND songGenres.songId = songs.songId
		WHERE songs.serverId = ? AND songs.artistId = ?
		UNION
		SELECT albums.serverId, albums.artistId, albumGenres.genreId
		FROM albums
		JOIN albumGenres ON albumGenres.serverId = albums.serverId AND albumGenres.albumId = albums.albumId
		WHERE albums.serverId = ? AND albums.artistId = ?
		UNION
		SELECT songArtists.serverId, songArtists.artistId, songGenres.genreId
		FROM songArtists
		JOIN songGenres ON songGenres.serverId = songArtists.serverId
			AND songGenres.songId = songArtists.songId
		WHERE songArtists.serverId = ? AND songArtists.artistId = ?
		UNION
		SELECT albumArtists.serverId, albumArtists.artistId, albumGenres.genreId
		FROM albumArtists
		JOIN albumGenres ON albumGenres.serverId = albumArtists.serverId
			AND albumGenres.albumId = albumArtists.albumId
		WHERE albumArtists.serverId = ? AND albumArtists.artistId = ?
	`, serverId, artistId, serverId, artistId, serverId, artistId, serverId, artistId)
}

const replaceGenres = async (database, table, idColumn, serverId, itemId, genres) => {
	if (genres === null) return
	await database.runAsync(
		`DELETE FROM ${table} WHERE serverId = ? AND ${idColumn} = ?`,
		serverId,
		itemId,
	)
	for (const genreId of genres) {
		await database.runAsync(
			`INSERT INTO ${table} (serverId, ${idColumn}, genreId) VALUES (?, ?, ?)`,
			serverId,
			itemId,
			genreId,
		)
	}
}

const saveArtistIdentity = async (database, serverId, artist, updatedAt) => {
	if (!artist?.id || !artist?.name) return false
	await database.runAsync(`
		INSERT INTO artists (serverId, artistId, name, sortName, coverArtId, updatedAt)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (serverId, artistId) DO UPDATE SET
			name = excluded.name,
			sortName = excluded.sortName,
			coverArtId = excluded.coverArtId,
			updatedAt = excluded.updatedAt
	`, serverId, artist.id, artist.name, artist.sortName || null, artist.coverArt || null, updatedAt)
	return true
}

const ensureArtistReference = async (database, serverId, artist) => {
	if (!artist?.id || !artist?.name) return false
	await database.runAsync(`
		INSERT INTO artists (serverId, artistId, name, sortName, coverArtId, updatedAt)
		VALUES (?, ?, ?, ?, ?, NULL)
		ON CONFLICT (serverId, artistId) DO UPDATE SET
			name = excluded.name,
			sortName = COALESCE(excluded.sortName, artists.sortName),
			coverArtId = COALESCE(excluded.coverArtId, artists.coverArtId)
	`, serverId, artist.id, artist.name, artist.sortName || null, artist.coverArt || null)
	return true
}

export const saveArtistReferences = async (config, artists = []) => {
	if (!artists.length) return
	const serverId = getServerId(config)
	await runDatabaseWrite('save-artist-references', database => database.withExclusiveTransactionAsync(async transaction => {
		for (const artist of artists) await ensureArtistReference(transaction, serverId, artist)
	}))
}

const replaceAlbumArtists = async (database, serverId, album) => {
	const artists = Array.isArray(album?.artists)
		? album.artists
		: album?.artistId && album?.artist ? [{ id: album.artistId, name: album.artist }] : null
	if (!artists) return
	await database.runAsync(
		'DELETE FROM albumArtists WHERE serverId = ? AND albumId = ?',
		serverId,
		album.id,
	)
	for (const [position, artist] of artists.entries()) {
		if (!await ensureArtistReference(database, serverId, artist)) continue
		await database.runAsync(`
			INSERT INTO albumArtists (serverId, albumId, artistId, position)
			VALUES (?, ?, ?, ?)
		`, serverId, album.id, artist.id, position)
	}
}

const replaceSongArtists = async (database, serverId, song) => {
	const artists = Array.isArray(song?.artists)
		? song.artists
		: song?.artistId && song?.artist ? [{ id: song.artistId, name: song.artist }] : null
	if (!artists) return
	await database.runAsync(
		'DELETE FROM songArtists WHERE serverId = ? AND songId = ?',
		serverId,
		song.id,
	)
	for (const [position, artist] of artists.entries()) {
		if (!await ensureArtistReference(database, serverId, artist)) continue
		await database.runAsync(`
			INSERT INTO songArtists (serverId, songId, artistId, position)
			VALUES (?, ?, ?, ?)
		`, serverId, song.id, artist.id, position)
	}
}

const restoreSong = row => row ? {
	...row,
	id: row.songId,
	coverArt: row.coverArtId,
} : row

export const getCachedAlbum = async (serverId, albumId) => {
	if (!albumId) return null
	const database = await getDatabase()
	const album = await database.getFirstAsync(
		'SELECT * FROM albums WHERE serverId = ? AND albumId = ?',
		serverId,
		albumId,
	)
	if (!album) return null
	const artists = await database.getAllAsync(`
		SELECT artists.artistId AS id, artists.name, artists.coverArtId AS coverArt
		FROM albumArtists
		JOIN artists ON artists.serverId = albumArtists.serverId
			AND artists.artistId = albumArtists.artistId
		WHERE albumArtists.serverId = ? AND albumArtists.albumId = ?
		ORDER BY albumArtists.position
	`, serverId, albumId)
	const songRows = await database.getAllAsync(`
		SELECT songId FROM songs
		WHERE serverId = ? AND albumId = ?
		ORDER BY discNumber, track
	`, serverId, albumId)
	const song = await Promise.all(songRows.map(row => getCachedSong(serverId, row.songId)))
	return { ...album, id: album.albumId, coverArt: album.coverArtId, artists, song }
}

export const getCachedSong = async (serverId, songId) => {
	if (!songId) return null
	const database = await getDatabase()
	const song = restoreSong(await database.getFirstAsync(
		'SELECT * FROM songs WHERE serverId = ? AND songId = ?',
		serverId,
		songId,
	))
	if (!song) return null
	const artists = await database.getAllAsync(`
		SELECT artists.artistId AS id, artists.name, artists.coverArtId AS coverArt
		FROM songArtists
		JOIN artists ON artists.serverId = songArtists.serverId
			AND artists.artistId = songArtists.artistId
		WHERE songArtists.serverId = ? AND songArtists.songId = ?
		ORDER BY songArtists.position
	`, serverId, songId)
	return { ...song, artists }
}

export const getCachedArtist = async (serverId, artistId) => {
	if (!artistId) return null
	const database = await getDatabase()
	const artist = await database.getFirstAsync(`
		SELECT artists.*, artistDetails.albumCount, artistDetails.artistImageUrl,
			artistDetails.starred, artistDetails.userRating,
			artistDetails.updatedAt AS artistDetailsUpdatedAt
		FROM artists
		LEFT JOIN artistDetails ON artistDetails.serverId = artists.serverId
			AND artistDetails.artistId = artists.artistId
		WHERE artists.serverId = ? AND artists.artistId = ?
	`,
		serverId,
		artistId,
	)
	if (!artist) return null
	const album = await database.getAllAsync(`
		SELECT albums.albumId AS id, albums.name, albums.artistId,
			COALESCE(albums.artist, artists.name) AS artist,
			albums.coverArtId AS coverArt, albums.year, albums.songCount,
			albums.duration, albums.starred, albums.userRating, albums.averageRating
		FROM albums
		LEFT JOIN artists ON artists.serverId = albums.serverId
			AND artists.artistId = albums.artistId
		WHERE albums.serverId = ? AND (
			albums.artistId = ? OR EXISTS (
				SELECT 1 FROM albumArtists
				WHERE albumArtists.serverId = albums.serverId
					AND albumArtists.albumId = albums.albumId
					AND albumArtists.artistId = ?
			)
		)
		ORDER BY albums.year DESC, albums.name
	`, serverId, artistId, artistId)
	return { ...artist, id: artist.artistId, coverArt: artist.coverArtId, album }
}

export const getCachedArtistInfo = async (serverId, artistId) => {
	if (!artistId) return null
	const database = await getDatabase()
	const info = await database.getFirstAsync(
		'SELECT * FROM artistInfo WHERE serverId = ? AND artistId = ?',
		serverId,
		artistId,
	)
	if (!info) return null
	const similarArtist = await database.getAllAsync(`
		SELECT artists.artistId AS id, artists.name, artists.coverArtId AS coverArt
		FROM similarArtists
		JOIN artists ON artists.serverId = similarArtists.serverId
			AND artists.artistId = similarArtists.similarArtistId
		WHERE similarArtists.serverId = ? AND similarArtists.artistId = ?
		ORDER BY similarArtists.position
	`, serverId, artistId)
	return { ...info, similarArtist }
}

export const getCachedStructuredResponse = async (config, path, query = '') => {
	const id = getQueryValue(query, 'id')
	if (!id) return null
	const serverId = getServerId(config)
	let item = null
	let timestamp = null
	let key = null

	if (path === 'getSong') {
		item = await getCachedSong(serverId, id)
		timestamp = item?.updatedAt
		key = 'song'
	} else if (path === 'getAlbum') {
		item = await getCachedAlbum(serverId, id)
		timestamp = item?.updatedAt
		key = 'album'
	} else if (path === 'getArtist') {
		item = await getCachedArtist(serverId, id)
		timestamp = item?.artistDetailsUpdatedAt
		key = 'artist'
	} else if (path === 'getArtistInfo') {
		item = await getCachedArtistInfo(serverId, id)
		timestamp = item?.updatedAt
		key = 'artistInfo'
	}

	if (!item || !key) return null
	const oldestValidTimestamp = Date.now() - CATALOG_MAX_AGE
	const hasCompleteAlbumSongs = path !== 'getAlbum'
		|| !item.songCount
		|| (item.song.length >= item.songCount
			&& item.song.every(song => song.updatedAt && song.updatedAt >= oldestValidTimestamp))
	return {
		json: { [key]: item },
		isFresh: Boolean(
			timestamp
			&& timestamp >= oldestValidTimestamp
			&& hasCompleteAlbumSongs
		),
	}
}

export const getCachedAudio = async (config, songId, format) => {
	if (!songId || !format) return null
	const database = await getDatabase()
	return database.getFirstAsync(
		'SELECT * FROM cacheAudio WHERE serverId = ? AND songId = ? AND format = ?',
		getServerId(config),
		songId,
		format,
	)
}

export const getCachedCover = async (config, coverArtId, size = 'original') => {
	if (!coverArtId) return null
	const database = await getDatabase()
	return database.getFirstAsync(
		'SELECT * FROM cacheCover WHERE serverId = ? AND coverArtId = ? AND size = ?',
		getServerId(config),
		coverArtId,
		size,
	)
}

export const saveCachedAudio = async ({ config, song, format, maxBitRate, fileSize, cacheKind }) => {
	const serverId = getServerId(config)

	await runDatabaseWrite('save-cached-audio', database => database.withExclusiveTransactionAsync(async transaction => {
		await transaction.runAsync(`
			INSERT INTO cacheAudio (serverId, songId, format, maxBitRate, fileSize, cacheKind, cachedAt)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (serverId, songId, format) DO UPDATE SET
				maxBitRate = excluded.maxBitRate,
				fileSize = excluded.fileSize,
				cacheKind = CASE WHEN excluded.cacheKind = 'manual' THEN 'manual' ELSE cacheAudio.cacheKind END,
				cachedAt = excluded.cachedAt
		`,
		serverId,
		song.id,
		format,
		maxBitRate,
		fileSize,
		cacheKind,
		Date.now(),
		)

	}))

	return serverId
}

export const saveAlbum = async (serverId, album) => {
	if (!album?.id || !album?.name) return
	const updatedAt = Date.now()
	await runDatabaseWrite('save-album', database => database.withExclusiveTransactionAsync(async transaction => {
		await transaction.runAsync(`
			INSERT INTO albums (
				serverId, albumId, artistId, artist, name, coverArtId, year, songCount,
				duration, starred, userRating, averageRating, playCount, played, created,
				updatedAt
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (serverId, albumId) DO UPDATE SET
				artistId = excluded.artistId,
				artist = excluded.artist,
				name = excluded.name,
				coverArtId = excluded.coverArtId,
				year = excluded.year,
				songCount = excluded.songCount,
				duration = excluded.duration,
				starred = excluded.starred,
				userRating = excluded.userRating,
				averageRating = excluded.averageRating,
				playCount = excluded.playCount,
				played = excluded.played,
				created = excluded.created,
				updatedAt = excluded.updatedAt
		`, serverId, album.id, album.artistId || null, album.artist || null, album.name,
		album.coverArt || null, album.year ?? null, album.songCount ?? null, album.duration ?? null,
		album.starred || null, album.userRating ?? null, album.averageRating ?? null,
		album.playCount ?? null, album.played || null, album.created || null, updatedAt)

		await replaceGenres(transaction, 'albumGenres', 'albumId', serverId, album.id, getGenreNames(album))
		await replaceAlbumArtists(transaction, serverId, album)
		await rebuildArtistGenres(transaction, serverId, album.artistId)
	}))
}

export const saveArtist = async (serverId, artist) => {
	if (!artist?.id || !artist?.name) return
	const updatedAt = Date.now()
	await runDatabaseWrite('save-artist', database => database.withExclusiveTransactionAsync(async transaction => {
		await saveArtistIdentity(transaction, serverId, artist, updatedAt)
		await saveArtistDetails(transaction, serverId, artist, updatedAt)
	}))
}

const saveArtistDetails = async (database, serverId, artist, updatedAt) => {
	await database.runAsync(`
		INSERT INTO artistDetails (
			serverId, artistId, albumCount, artistImageUrl, starred,
			userRating, updatedAt
		)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (serverId, artistId) DO UPDATE SET
			albumCount = excluded.albumCount,
			artistImageUrl = excluded.artistImageUrl,
			starred = excluded.starred,
			userRating = excluded.userRating,
			updatedAt = excluded.updatedAt
	`, serverId, artist.id, artist.albumCount ?? null, artist.artistImageUrl || null,
	artist.starred || null, artist.userRating ?? null, updatedAt)
}

export const saveArtistInfo = async (config, artistId, info) => {
	if (!artistId || !info) return
	const serverId = getServerId(config)
	const updatedAt = Date.now()
	await runDatabaseWrite('save-artist-info', database => database.withExclusiveTransactionAsync(async transaction => {
		await transaction.runAsync(`
			INSERT INTO artistInfo (
				serverId, artistId, biography, musicBrainzId, lastFmUrl,
				smallImageUrl, mediumImageUrl, largeImageUrl, updatedAt
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (serverId, artistId) DO UPDATE SET
				biography = excluded.biography,
				musicBrainzId = excluded.musicBrainzId,
				lastFmUrl = excluded.lastFmUrl,
				smallImageUrl = excluded.smallImageUrl,
				mediumImageUrl = excluded.mediumImageUrl,
				largeImageUrl = excluded.largeImageUrl,
				updatedAt = excluded.updatedAt
		`, serverId, artistId, info.biography || null, info.musicBrainzId || null,
		info.lastFmUrl || null, info.smallImageUrl || null, info.mediumImageUrl || null,
		info.largeImageUrl || null, updatedAt)

		await transaction.runAsync(
			'DELETE FROM similarArtists WHERE serverId = ? AND artistId = ?',
			serverId,
			artistId,
		)
		for (const [position, artist] of (info.similarArtist || []).entries()) {
			if (!await ensureArtistReference(transaction, serverId, artist)) continue
			await transaction.runAsync(`
				INSERT INTO similarArtists (serverId, artistId, similarArtistId, position)
				VALUES (?, ?, ?, ?)
			`, serverId, artistId, artist.id, position)
		}
	}))
}

export const saveCover = async ({ serverId, coverArtId, size = 'original', filePath, fileSize }) => {
	await runDatabaseWrite('save-cover', database => database.runAsync(`
		INSERT INTO cacheCover (serverId, coverArtId, size, filePath, fileSize, cachedAt)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (serverId, coverArtId, size) DO UPDATE SET
			filePath = excluded.filePath,
			fileSize = excluded.fileSize,
			cachedAt = excluded.cachedAt
	`, serverId, coverArtId, size, filePath, fileSize, Date.now()))
}

export const saveCatalogItems = async (config, {
	songs = [], albums = [], artists = [],
	detailedArtistIds = [],
}) => {
	if (!songs.length && !albums.length && !artists.length) return
	const serverId = getServerId(config)
	const updatedAt = Date.now()
	const detailedArtists = new Set(detailedArtistIds.map(String))
	await runDatabaseWrite('save-catalog-items', database => database.withExclusiveTransactionAsync(async transaction => {
		const affectedArtistIds = new Set()

		for (const artist of artists) {
			if (!await saveArtistIdentity(transaction, serverId, artist, updatedAt)) continue
			if (detailedArtists.has(String(artist.id))) {
				await saveArtistDetails(transaction, serverId, artist, updatedAt)
			}
			affectedArtistIds.add(artist.id)
		}

		for (const album of albums) {
			if (!album?.id || !(album.name || album.title)) continue
			await transaction.runAsync(`
				INSERT INTO albums (
					serverId, albumId, artistId, artist, name, coverArtId, year, songCount,
					duration, starred, userRating, averageRating, playCount, played, created,
					updatedAt
				)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT (serverId, albumId) DO UPDATE SET
					artistId = excluded.artistId,
					artist = excluded.artist,
					name = excluded.name,
					coverArtId = excluded.coverArtId,
					year = excluded.year,
					songCount = excluded.songCount,
					duration = excluded.duration,
					starred = excluded.starred,
					userRating = excluded.userRating,
					averageRating = excluded.averageRating,
					playCount = excluded.playCount,
					played = excluded.played,
					created = excluded.created,
					updatedAt = excluded.updatedAt
			`, serverId, album.id, album.artistId || null, album.artist || null, album.name || album.title,
			album.coverArt || null, album.year ?? null, album.songCount ?? null, album.duration ?? null,
			album.starred || null, album.userRating ?? null, album.averageRating ?? null,
			album.playCount ?? null, album.played || null, album.created || null, updatedAt)
			await replaceGenres(transaction, 'albumGenres', 'albumId', serverId, album.id, getGenreNames(album))
			await replaceAlbumArtists(transaction, serverId, album)
			if (album.artistId) affectedArtistIds.add(album.artistId)
			album.artists?.forEach(artist => artist?.id && affectedArtistIds.add(artist.id))
		}

		for (const song of songs) {
			if (!song?.id || !song?.title) continue
			await transaction.runAsync(`
				INSERT INTO songs (
					serverId, songId, albumId, album, artistId, artist, title, coverArtId,
					track, discNumber, duration, year, genre, starred, userRating, averageRating,
					playCount, played, created, suffix, contentType, bitRate, size, path,
					updatedAt
				)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT (serverId, songId) DO UPDATE SET
					albumId = excluded.albumId,
					album = excluded.album,
					artistId = excluded.artistId,
					artist = excluded.artist,
					title = excluded.title,
					coverArtId = excluded.coverArtId,
					track = excluded.track,
					discNumber = excluded.discNumber,
					duration = excluded.duration,
					year = excluded.year,
					genre = excluded.genre,
					starred = excluded.starred,
					userRating = excluded.userRating,
					averageRating = excluded.averageRating,
					playCount = excluded.playCount,
					played = excluded.played,
					created = excluded.created,
					suffix = excluded.suffix,
					contentType = excluded.contentType,
					bitRate = excluded.bitRate,
					size = excluded.size,
					path = excluded.path,
					updatedAt = excluded.updatedAt
			`, serverId, song.id, song.albumId || null, song.album || null,
			song.artistId || null, song.artist || null, song.title, song.coverArt || null,
			song.track ?? null, song.discNumber ?? null, song.duration ?? null, song.year ?? null,
			song.genre || null, song.starred || null, song.userRating ?? null, song.averageRating ?? null,
			song.playCount ?? null, song.played || null, song.created || null, song.suffix || null,
			song.contentType || null, song.bitRate ?? null, song.size ?? null, song.path || null,
			updatedAt)
			await replaceGenres(transaction, 'songGenres', 'songId', serverId, song.id, getGenreNames(song))
			await replaceSongArtists(transaction, serverId, song)
			if (song.artistId) affectedArtistIds.add(song.artistId)
			song.artists?.forEach(artist => artist?.id && affectedArtistIds.add(artist.id))
		}

		for (const artistId of affectedArtistIds) {
			await rebuildArtistGenres(transaction, serverId, artistId)
		}
	}))
}

export const getCachedMediaInfo = async (config, format = null) => {
	const database = await getDatabase()
	const serverId = getServerId(config)
	const formatFilter = format ? 'AND cacheAudio.format = ?' : ''
	const parameters = format ? [serverId, format] : [serverId]
	const songs = await database.getAllAsync(`
		SELECT songs.songId AS id, songs.title, songs.albumId, songs.artistId,
			COALESCE(songs.album, albums.name) AS album,
			COALESCE(songs.artist, artists.name) AS artist, songs.coverArtId AS coverArt,
			albums.coverArtId AS albumCoverArt, artists.coverArtId AS artistCoverArt,
			albums.year AS albumYear, albums.starred AS albumStarred,
			albums.userRating AS albumUserRating, albums.averageRating AS albumAverageRating,
			albums.songCount AS albumSongCount, albums.duration AS albumDuration,
			artistDetails.albumCount AS artistAlbumCount,
			artistDetails.starred AS artistStarred,
			GROUP_CONCAT(cacheAudio.format, '|') AS cachedFormats,
			songs.track, songs.discNumber, songs.duration, songs.year, songs.genre,
			songs.starred, songs.userRating, songs.averageRating, songs.playCount, songs.played,
			songs.created, songs.suffix, songs.contentType, songs.bitRate, songs.size, songs.path
		FROM songs
		JOIN cacheAudio ON cacheAudio.serverId = songs.serverId AND cacheAudio.songId = songs.songId
		LEFT JOIN albums ON albums.serverId = songs.serverId AND albums.albumId = songs.albumId
		LEFT JOIN artists ON artists.serverId = songs.serverId AND artists.artistId = songs.artistId
		LEFT JOIN artistDetails ON artistDetails.serverId = artists.serverId
			AND artistDetails.artistId = artists.artistId
		WHERE songs.serverId = ? ${formatFilter}
		GROUP BY songs.serverId, songs.songId
	`, ...parameters)
	const songArtistRows = await database.getAllAsync(`
		SELECT songArtists.songId, artists.artistId AS id, artists.name,
			artists.coverArtId AS coverArt, songArtists.position
		FROM songArtists
		JOIN artists ON artists.serverId = songArtists.serverId
			AND artists.artistId = songArtists.artistId
		WHERE songArtists.serverId = ?
		ORDER BY songArtists.songId, songArtists.position
	`, serverId)
	const albumArtistRows = await database.getAllAsync(`
		SELECT albumArtists.albumId, artists.artistId AS id, artists.name,
			artists.coverArtId AS coverArt, albumArtists.position
		FROM albumArtists
		JOIN artists ON artists.serverId = albumArtists.serverId
			AND artists.artistId = albumArtists.artistId
		WHERE albumArtists.serverId = ?
		ORDER BY albumArtists.albumId, albumArtists.position
	`, serverId)
	const artistsBySong = new Map()
	const artistsByAlbum = new Map()
	for (const row of songArtistRows) {
		if (!artistsBySong.has(row.songId)) artistsBySong.set(row.songId, [])
		artistsBySong.get(row.songId).push({
			id: row.id,
			name: row.name,
			coverArt: row.coverArt,
		})
	}
	for (const row of albumArtistRows) {
		if (!artistsByAlbum.has(row.albumId)) artistsByAlbum.set(row.albumId, [])
		artistsByAlbum.get(row.albumId).push({
			id: row.id,
			name: row.name,
			coverArt: row.coverArt,
		})
	}
	const hydratedSongs = songs.map(song => ({
		...song,
		artists: artistsBySong.get(song.id) || [],
		albumArtists: artistsByAlbum.get(song.albumId) || [],
	}))
	return {
		cachedSongs: hydratedSongs,
		cachedSongIds: new Set(hydratedSongs.map(song => String(song.id))),
		cachedAlbumIds: new Set(hydratedSongs.map(song => song.albumId).filter(Boolean).map(String)),
		cachedArtistIds: new Set(hydratedSongs.flatMap(song => [
			song.artistId,
			...song.artists.map(artist => artist.id),
			...song.albumArtists.map(artist => artist.id),
		]).filter(Boolean).map(String)),
	}
}

const collectOrphanCover = async (database, serverId, coverArtId, coverFiles) => {
	if (!coverArtId) return
	const reference = await database.getFirstAsync(`
		SELECT 1 AS found
		FROM songs
		JOIN cacheAudio ON cacheAudio.serverId = songs.serverId AND cacheAudio.songId = songs.songId
		WHERE songs.serverId = ? AND songs.coverArtId = ?
		UNION
		SELECT 1
		FROM albums
		JOIN songs ON songs.serverId = albums.serverId AND songs.albumId = albums.albumId
		JOIN cacheAudio ON cacheAudio.serverId = songs.serverId AND cacheAudio.songId = songs.songId
		WHERE albums.serverId = ? AND albums.coverArtId = ?
		UNION
		SELECT 1
		FROM artists
		JOIN songs ON songs.serverId = artists.serverId AND songs.artistId = artists.artistId
		JOIN cacheAudio ON cacheAudio.serverId = songs.serverId AND cacheAudio.songId = songs.songId
		WHERE artists.serverId = ? AND artists.coverArtId = ?
		LIMIT 1
	`, serverId, coverArtId, serverId, coverArtId, serverId, coverArtId)
	if (reference) return
	const rows = await database.getAllAsync(
		'SELECT filePath FROM cacheCover WHERE serverId = ? AND coverArtId = ?',
		serverId,
		coverArtId,
	)
	rows.forEach(row => row.filePath && coverFiles.add(row.filePath))
	await database.runAsync(
		'DELETE FROM cacheCover WHERE serverId = ? AND coverArtId = ?',
		serverId,
		coverArtId,
	)
}

export const deleteCachedSong = async (config, songId, format) => {
	const serverId = getServerId(config)
	const coverFiles = new Set()

	await runDatabaseWrite('delete-cached-song', database => database.withExclusiveTransactionAsync(async transaction => {
		const song = await transaction.getFirstAsync(
			'SELECT albumId, artistId, coverArtId FROM songs WHERE serverId = ? AND songId = ?',
			serverId,
			songId,
		)
		await transaction.runAsync(
			'DELETE FROM cacheAudio WHERE serverId = ? AND songId = ? AND format = ?',
			serverId,
			songId,
			format,
		)
		if (!song) return
		const album = song.albumId ? await transaction.getFirstAsync(
			'SELECT coverArtId FROM albums WHERE serverId = ? AND albumId = ?', serverId, song.albumId,
		) : null
		const artist = song.artistId ? await transaction.getFirstAsync(
			'SELECT coverArtId FROM artists WHERE serverId = ? AND artistId = ?', serverId, song.artistId,
		) : null

		for (const coverArtId of new Set([song.coverArtId, album?.coverArtId, artist?.coverArtId].filter(Boolean))) {
			await collectOrphanCover(transaction, serverId, coverArtId, coverFiles)
		}
	}))

	return [...coverFiles]
}

export const clearCachedAudio = async config => {
	const serverId = getServerId(config)
	await runDatabaseWrite('clear-cached-audio', database => database.runAsync(
		'DELETE FROM cacheAudio WHERE serverId = ?', serverId,
	))
}

export const clearCachedCovers = async config => {
	const serverId = getServerId(config)
	await runDatabaseWrite('clear-cached-covers', database => database.runAsync(
		'DELETE FROM cacheCover WHERE serverId = ?', serverId,
	))
}
