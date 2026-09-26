export const SONGS_TABLE_SCHEMA = `
	CREATE TABLE IF NOT EXISTS songs (
		serverId TEXT NOT NULL,
		songId TEXT NOT NULL,
		albumId TEXT,
		album TEXT,
		artistId TEXT,
		artist TEXT,
		title TEXT NOT NULL,
		coverArtId TEXT,
		track INTEGER,
		discNumber INTEGER,
		duration INTEGER,
		year INTEGER,
		genre TEXT,
		starred TEXT,
		userRating INTEGER,
		averageRating REAL,
		playCount INTEGER,
		played TEXT,
		created TEXT,
		suffix TEXT,
		contentType TEXT,
		bitRate INTEGER,
		size INTEGER,
		path TEXT,
		updatedAt INTEGER,
		PRIMARY KEY (serverId, songId)
	);
`

export const ALBUMS_TABLE_SCHEMA = `
	CREATE TABLE IF NOT EXISTS albums (
		serverId TEXT NOT NULL,
		albumId TEXT NOT NULL,
		artistId TEXT,
		artist TEXT,
		name TEXT NOT NULL,
		coverArtId TEXT,
		year INTEGER,
		songCount INTEGER,
		duration INTEGER,
		starred TEXT,
		userRating INTEGER,
		averageRating REAL,
		playCount INTEGER,
		played TEXT,
		created TEXT,
		updatedAt INTEGER,
		PRIMARY KEY (serverId, albumId)
	);
`

export const ALBUM_ARTISTS_TABLE_SCHEMA = `
	CREATE TABLE IF NOT EXISTS albumArtists (
		serverId TEXT NOT NULL,
		albumId TEXT NOT NULL,
		artistId TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (serverId, albumId, artistId)
	);
`

export const SONG_ARTISTS_TABLE_SCHEMA = `
	CREATE TABLE IF NOT EXISTS songArtists (
		serverId TEXT NOT NULL,
		songId TEXT NOT NULL,
		artistId TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (serverId, songId, artistId)
	);
`

export const ARTISTS_TABLE_SCHEMA = `
	CREATE TABLE IF NOT EXISTS artists (
		serverId TEXT NOT NULL,
		artistId TEXT NOT NULL,
		name TEXT NOT NULL,
		sortName TEXT,
		coverArtId TEXT,
		updatedAt INTEGER,
		PRIMARY KEY (serverId, artistId)
	);
`

export const ARTIST_DETAILS_TABLE_SCHEMA = `
	CREATE TABLE IF NOT EXISTS artistDetails (
		serverId TEXT NOT NULL,
		artistId TEXT NOT NULL,
		albumCount INTEGER,
		artistImageUrl TEXT,
		starred TEXT,
		userRating INTEGER,
		updatedAt INTEGER NOT NULL,
		PRIMARY KEY (serverId, artistId)
	);
`

export const ARTIST_INFO_TABLE_SCHEMA = `
	CREATE TABLE IF NOT EXISTS artistInfo (
		serverId TEXT NOT NULL,
		artistId TEXT NOT NULL,
		biography TEXT,
		musicBrainzId TEXT,
		lastFmUrl TEXT,
		smallImageUrl TEXT,
		mediumImageUrl TEXT,
		largeImageUrl TEXT,
		updatedAt INTEGER NOT NULL,
		PRIMARY KEY (serverId, artistId)
	);
`

export const SIMILAR_ARTISTS_TABLE_SCHEMA = `
	CREATE TABLE IF NOT EXISTS similarArtists (
		serverId TEXT NOT NULL,
		artistId TEXT NOT NULL,
		similarArtistId TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (serverId, artistId, similarArtistId)
	);
`

export const DATABASE_SCHEMA = `
	${ARTISTS_TABLE_SCHEMA}

	${ARTIST_DETAILS_TABLE_SCHEMA}

	${ARTIST_INFO_TABLE_SCHEMA}

	${SIMILAR_ARTISTS_TABLE_SCHEMA}

	${ALBUMS_TABLE_SCHEMA}

	${SONGS_TABLE_SCHEMA}

	${ALBUM_ARTISTS_TABLE_SCHEMA}

	${SONG_ARTISTS_TABLE_SCHEMA}

	CREATE TABLE IF NOT EXISTS cacheAudio (
		serverId TEXT NOT NULL,
		songId TEXT NOT NULL,
		format TEXT NOT NULL,
		maxBitRate INTEGER NOT NULL DEFAULT 0,
		fileSize INTEGER,
		cacheKind TEXT NOT NULL,
		cachedAt INTEGER NOT NULL,
		PRIMARY KEY (serverId, songId, format)
	);

	CREATE TABLE IF NOT EXISTS cacheCover (
		serverId TEXT NOT NULL,
		coverArtId TEXT NOT NULL,
		size TEXT NOT NULL,
		filePath TEXT NOT NULL,
		fileSize INTEGER,
		cachedAt INTEGER NOT NULL,
		PRIMARY KEY (serverId, coverArtId, size)
	);

	CREATE TABLE IF NOT EXISTS songGenres (
		serverId TEXT NOT NULL,
		songId TEXT NOT NULL,
		genreId TEXT NOT NULL,
		PRIMARY KEY (serverId, songId, genreId)
	);

	CREATE TABLE IF NOT EXISTS albumGenres (
		serverId TEXT NOT NULL,
		albumId TEXT NOT NULL,
		genreId TEXT NOT NULL,
		PRIMARY KEY (serverId, albumId, genreId)
	);

	CREATE TABLE IF NOT EXISTS artistGenres (
		serverId TEXT NOT NULL,
		artistId TEXT NOT NULL,
		genreId TEXT NOT NULL,
		PRIMARY KEY (serverId, artistId, genreId)
	);

	CREATE TABLE IF NOT EXISTS lastQueue (
		serverId TEXT NOT NULL,
		songId TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (serverId, position)
	);

	CREATE TABLE IF NOT EXISTS playQueueState (
		serverId TEXT NOT NULL PRIMARY KEY,
		currentSongId TEXT,
		currentPosition INTEGER,
		username TEXT,
		changed TEXT,
		changedBy TEXT,
		updatedAt INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS lyrics (
		serverId TEXT NOT NULL,
		songId TEXT NOT NULL,
		source TEXT NOT NULL,
		language TEXT,
		synced INTEGER NOT NULL,
		offset INTEGER,
		displayArtist TEXT,
		displayTitle TEXT,
		updatedAt INTEGER NOT NULL,
		PRIMARY KEY (serverId, songId)
	);

	CREATE TABLE IF NOT EXISTS lyricLines (
		serverId TEXT NOT NULL,
		songId TEXT NOT NULL,
		position INTEGER NOT NULL,
		startMs INTEGER,
		text TEXT NOT NULL,
		PRIMARY KEY (serverId, songId, position)
	);

	CREATE TABLE IF NOT EXISTS favoritedArtists (
		serverId TEXT NOT NULL,
		artistId TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (serverId, artistId)
	);

	CREATE TABLE IF NOT EXISTS favoritedAlbums (
		serverId TEXT NOT NULL,
		albumId TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (serverId, albumId)
	);

	CREATE TABLE IF NOT EXISTS favoritedSongs (
		serverId TEXT NOT NULL,
		songId TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (serverId, songId)
	);

	CREATE TABLE IF NOT EXISTS artistTopSongs (
		serverId TEXT NOT NULL,
		artistName TEXT NOT NULL,
		songId TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (serverId, artistName, songId)
	);

	CREATE TABLE IF NOT EXISTS similarSongs (
		serverId TEXT NOT NULL,
		sourceId TEXT NOT NULL,
		songId TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (serverId, sourceId, songId)
	);

	CREATE TABLE IF NOT EXISTS genres (
		serverId TEXT NOT NULL,
		genreId TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (serverId, genreId)
	);

	CREATE TABLE IF NOT EXISTS radioStations (
		serverId TEXT NOT NULL,
		radioId TEXT NOT NULL,
		name TEXT NOT NULL,
		streamUrl TEXT NOT NULL,
		homePageUrl TEXT,
		updatedAt INTEGER NOT NULL,
		PRIMARY KEY (serverId, radioId)
	);

	CREATE TABLE IF NOT EXISTS radios (
		serverId TEXT NOT NULL,
		radioId TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (serverId, radioId)
	);

	CREATE TABLE IF NOT EXISTS pinnedPlaylists (
		serverId TEXT NOT NULL,
		playlistId TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (serverId, playlistId)
	);

	CREATE TABLE IF NOT EXISTS playlists (
		serverId TEXT NOT NULL,
		playlistId TEXT NOT NULL,
		name TEXT NOT NULL,
		comment TEXT,
		owner TEXT,
		public INTEGER,
		songCount INTEGER,
		duration INTEGER,
		created TEXT,
		changed TEXT,
		coverArtId TEXT,
		updatedAt INTEGER NOT NULL,
		PRIMARY KEY (serverId, playlistId)
	);

	CREATE TABLE IF NOT EXISTS playlistSongs (
		serverId TEXT NOT NULL,
		playlistId TEXT NOT NULL,
		songId TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (serverId, playlistId, position)
	);

	CREATE TABLE IF NOT EXISTS recentlyAdded (
		serverId TEXT NOT NULL,
		albumId TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (serverId, albumId)
	);

	CREATE TABLE IF NOT EXISTS mostPlayed (
		serverId TEXT NOT NULL,
		albumId TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (serverId, albumId)
	);

	CREATE TABLE IF NOT EXISTS recentlyPlayed (
		serverId TEXT NOT NULL,
		albumId TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (serverId, albumId)
	);

	CREATE TABLE IF NOT EXISTS randomAlbums (
		serverId TEXT NOT NULL,
		albumId TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (serverId, albumId)
	);

	CREATE TABLE IF NOT EXISTS highestAlbums (
		serverId TEXT NOT NULL,
		albumId TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (serverId, albumId)
	);

	CREATE INDEX IF NOT EXISTS indexAlbumsArtist
		ON albums (serverId, artistId);

	CREATE INDEX IF NOT EXISTS indexAlbumArtistsArtist
		ON albumArtists (serverId, artistId);

	CREATE INDEX IF NOT EXISTS indexSongArtistsArtist
		ON songArtists (serverId, artistId);

	CREATE INDEX IF NOT EXISTS indexSimilarArtistsTarget
		ON similarArtists (serverId, similarArtistId);

	CREATE INDEX IF NOT EXISTS indexSongsAlbum
		ON songs (serverId, albumId);

	CREATE INDEX IF NOT EXISTS indexSongsArtist
		ON songs (serverId, artistId);

	CREATE INDEX IF NOT EXISTS indexCacheAudioSong
		ON cacheAudio (serverId, songId);

	CREATE INDEX IF NOT EXISTS indexCacheCoverId
		ON cacheCover (serverId, coverArtId);

	CREATE INDEX IF NOT EXISTS indexSongGenresGenre
		ON songGenres (serverId, genreId);

	CREATE INDEX IF NOT EXISTS indexAlbumGenresGenre
		ON albumGenres (serverId, genreId);

	CREATE INDEX IF NOT EXISTS indexArtistGenresGenre
		ON artistGenres (serverId, genreId);

	CREATE INDEX IF NOT EXISTS indexLastQueuePosition
		ON lastQueue (serverId, position);

	CREATE INDEX IF NOT EXISTS indexPlaylistsName
		ON playlists (serverId, name);

	CREATE INDEX IF NOT EXISTS indexPlaylistSongsPosition
		ON playlistSongs (serverId, playlistId, position);

	CREATE INDEX IF NOT EXISTS indexFavoritedArtistsPosition
		ON favoritedArtists (serverId, position);

	CREATE INDEX IF NOT EXISTS indexFavoritedAlbumsPosition
		ON favoritedAlbums (serverId, position);

	CREATE INDEX IF NOT EXISTS indexFavoritedSongsPosition
		ON favoritedSongs (serverId, position);

	CREATE INDEX IF NOT EXISTS indexArtistTopSongsPosition
		ON artistTopSongs (serverId, artistName, position);

	CREATE INDEX IF NOT EXISTS indexSimilarSongsPosition
		ON similarSongs (serverId, sourceId, position);

	CREATE INDEX IF NOT EXISTS indexRecentlyAddedPosition
		ON recentlyAdded (serverId, position);

	CREATE INDEX IF NOT EXISTS indexMostPlayedPosition
		ON mostPlayed (serverId, position);

	CREATE INDEX IF NOT EXISTS indexRecentlyPlayedPosition
		ON recentlyPlayed (serverId, position);

	CREATE INDEX IF NOT EXISTS indexRandomAlbumsPosition
		ON randomAlbums (serverId, position);

	CREATE INDEX IF NOT EXISTS indexHighestAlbumsPosition
		ON highestAlbums (serverId, position);
`
