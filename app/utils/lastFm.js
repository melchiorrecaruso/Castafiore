const LAST_FM_API_URL = 'https://ws.audioscrobbler.com/2.0/'
const PAGE_SIZE = 200
const MAX_PAGES = 25

const getLocalDateKey = date => [
	date.getFullYear(),
	String(date.getMonth() + 1).padStart(2, '0'),
	String(date.getDate()).padStart(2, '0'),
].join('-')

const getWeekStart = (date = new Date()) => {
	const start = new Date(date)
	start.setHours(0, 0, 0, 0)
	const mondayOffset = (start.getDay() + 6) % 7
	start.setDate(start.getDate() - mondayOffset)
	return start
}

const createEmptyWeek = start => Array.from({ length: 7 }, (_, index) => {
	const from = new Date(start)
	from.setDate(start.getDate() + index)
	const to = new Date(from)
	to.setDate(from.getDate() + 1)
	to.setMilliseconds(-1)
	return {
		from_ts: Math.floor(from.getTime() / 1000),
		to_ts: Math.floor(to.getTime() / 1000),
		time_range: from.toISOString(),
		listen_count: 0,
	}
})

const getRecentTracksPage = async ({ apiKey, username, from, page }) => {
	const query = new URLSearchParams({
		method: 'user.getrecenttracks',
		user: username,
		api_key: apiKey,
		format: 'json',
		limit: String(PAGE_SIZE),
		page: String(page),
		from: String(from),
		extended: '0',
	})
	const response = await fetch(`${LAST_FM_API_URL}?${query}`)
	const data = await response.json().catch(() => null)
	if (!response.ok || data?.error) {
		throw new Error(data?.message || `Last.fm HTTP ${response.status}`)
	}
	return data?.recenttracks || null
}

export const getLastFmWeeklyActivity = async (config, username) => {
	if (!username) throw new Error('No Last.fm user set')
	if (!config?.lastFmApiKey) throw new Error('Last.fm API key not available; reconnect the Navidrome server')

	const weekStart = getWeekStart()
	const from = Math.floor(weekStart.getTime() / 1000)
	const activity = createEmptyWeek(weekStart)
	const activityByDay = new Map(activity.map((item, index) => [
		getLocalDateKey(new Date(item.from_ts * 1000)),
		index,
	]))
	let page = 1
	let totalPages = 1

	do {
		const recentTracks = await getRecentTracksPage({
			apiKey: config.lastFmApiKey,
			username,
			from,
			page,
		})
		if (!recentTracks) break
		const tracks = Array.isArray(recentTracks.track) ? recentTracks.track : []
		for (const track of tracks) {
			const timestamp = Number(track?.date?.uts)
			if (!Number.isFinite(timestamp)) continue
			const listenedAt = new Date(timestamp * 1000)
			const dayIndex = activityByDay.get(getLocalDateKey(listenedAt))
			if (dayIndex !== undefined) activity[dayIndex].listen_count += 1
		}
		totalPages = Math.max(1, Number(recentTracks['@attr']?.totalPages) || 1)
		page += 1
	} while (page <= totalPages && page <= MAX_PAGES)

	return activity
}

export const getNavidromeLastFmConfig = async (url, username, password) => {
	const loginResponse = await fetch(`${url}/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password }),
	})
	if (!loginResponse.ok) throw new Error(`Navidrome login HTTP ${loginResponse.status}`)
	const login = await loginResponse.json()
	if (!login?.token) throw new Error('Navidrome login did not return a token')

	const linkResponse = await fetch(`${url}/api/lastfm/link`, {
		headers: { 'X-ND-Authorization': `Bearer ${login.token}` },
	})
	if (!linkResponse.ok) throw new Error(`Navidrome Last.fm HTTP ${linkResponse.status}`)
	const link = await linkResponse.json()
	return {
		lastFmApiKey: link?.apiKey || null,
		lastFmLinked: link?.status === true,
	}
}
