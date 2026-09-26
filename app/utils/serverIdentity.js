import md5 from 'md5'

export const getServerId = config => {
	const url = config?.url?.replace(/\/$/, '').toLowerCase() || ''
	const username = config?.username?.toLowerCase() || ''
	return md5(`${url}|${username}`)
}
