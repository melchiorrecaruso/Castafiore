import { getDatabase, runDatabaseWrite } from '~/utils/database'
import { getServerId } from '~/utils/cacheDatabase'


export const getCachedLyrics = async (config, songId) => {
	if (!songId) return null
	const serverId = getServerId(config)
	const database = await getDatabase()
	const lyrics = await database.getFirstAsync(`
		SELECT source, language, synced, offset, displayArtist, displayTitle, updatedAt
		FROM lyrics
		WHERE serverId = ? AND songId = ?
	`, serverId, songId)
	if (!lyrics) return null
	const rows = await database.getAllAsync(`
		SELECT startMs, text
		FROM lyricLines
		WHERE serverId = ? AND songId = ?
		ORDER BY position
	`, serverId, songId)
	return {
		...lyrics,
		synced: Boolean(lyrics.synced),
		lines: rows.map(row => ({ time: (row.startMs || 0) / 1000, text: row.text })),
	}
}

export const saveLyrics = async (config, songId, lyrics) => {
	if (!songId || !lyrics?.source || !Array.isArray(lyrics.lines)) return
	const serverId = getServerId(config)
	const updatedAt = Date.now()
	await runDatabaseWrite('save-lyrics', database => database.withExclusiveTransactionAsync(async transaction => {
		await transaction.runAsync(`
			INSERT INTO lyrics (
				serverId, songId, source, language, synced, offset,
				displayArtist, displayTitle, updatedAt
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (serverId, songId) DO UPDATE SET
				source = excluded.source,
				language = excluded.language,
				synced = excluded.synced,
				offset = excluded.offset,
				displayArtist = excluded.displayArtist,
				displayTitle = excluded.displayTitle,
				updatedAt = excluded.updatedAt
		`, serverId, songId, lyrics.source, lyrics.language || null,
		lyrics.synced ? 1 : 0, lyrics.offset ?? null, lyrics.displayArtist || null,
		lyrics.displayTitle || null, updatedAt)
		await transaction.runAsync(
			'DELETE FROM lyricLines WHERE serverId = ? AND songId = ?',
			serverId, songId,
		)
		for (const [position, line] of lyrics.lines.entries()) {
			await transaction.runAsync(`
				INSERT INTO lyricLines (serverId, songId, position, startMs, text)
				VALUES (?, ?, ?, ?, ?)
			`, serverId, songId, position,
			Number.isFinite(line.time) ? Math.round(line.time * 1000) : null,
			String(line.text || ''))
		}
	}))
}
