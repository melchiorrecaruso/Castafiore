const getUrl = (config, path, query = '') => {
	const encodedQuery = Object.keys(query).map((key) => `${key}=${encodeURIComponent(query[key])}`).join('&')
	return `${config.url}/rest/${path}?${encodedQuery}&${config.query}`
}

const realCover = (config, id, size = null) => {
	if (!id) return null
	if (!size || size === 'original') {
		return getUrl(config, 'getCoverArt', { id })
	}
	return getUrl(config, 'getCoverArt', { id, size })
}

export const urlCover = (config, id, size = null) => {
	if (!id) return null
	if (!config?.url || !config?.query) return null
	if (typeof id === 'object') {
		const item = id

		if (item.id === 'tuktuktuk') return 'https://github.com/sawyerf/Castafiore/blob/main/assets/icon.png?raw=true'
		if (item.homePageUrl && item.homePageUrl.startsWith('http')) {
			return item.homePageUrl + '/favicon.ico'
		}
		return realCover(config, item.coverArt, size)
	} else {
		if (id.startsWith('http://') || id.startsWith('https://')) return id
		return realCover(config, id, size)
	}
}

export const urlStream = (config, id, format = 'raw', maxBitRate = 0) => {
	if (id === 'tuktuktuk') return 'https://sawyerf.github.io/tuktuktuk.mp3' 
	if (!id.match(/^[a-zA-Z0-9-]*$/)) return id
	if (format === 'raw') return getUrl(config, 'stream', { id })
	return getUrl(config, 'stream', { id, format, maxBitRate })
}
