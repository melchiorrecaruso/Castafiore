import { AppState } from 'react-native'

export const NETWORK_UNKNOWN = 'unknown'
export const NETWORK_ONLINE = 'online'
export const NETWORK_OFFLINE = 'offline'

const NETWORK_CHECK_TIMEOUT = 5000

let networkSnapshot = { status: NETWORK_UNKNOWN, serverInfo: null }
let initialCheck = null
const listeners = new Set()

export const getNetworkState = () => networkSnapshot.status
export const getNetworkSnapshot = () => networkSnapshot
export const subscribeNetworkState = listener => {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

export const setNetworkState = (status, serverInfo = networkSnapshot.serverInfo) => {
	if (networkSnapshot.status === status && networkSnapshot.serverInfo === serverInfo) return
	networkSnapshot = { status, serverInfo }
	listeners.forEach(listener => listener())
}

export const initializeNetworkState = config => {
	if (!config?.url || !config?.query) {
		setNetworkState(NETWORK_OFFLINE, null)
		return Promise.resolve(NETWORK_OFFLINE)
	}
	if (initialCheck) return initialCheck

	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), NETWORK_CHECK_TIMEOUT)
	const url = `${config.url}/rest/ping.view?${config.query}&f=json`

	initialCheck = fetch(url, { signal: controller.signal })
		.then(response => {
			if (!response.ok) throw new Error(`HTTP ${response.status}`)
			return response.json()
		})
		.then(json => {
			const serverInfo = json?.['subsonic-response']
			if (serverInfo?.status !== 'ok') throw new Error('Server ping failed')
			setNetworkState(NETWORK_ONLINE, serverInfo)
			return NETWORK_ONLINE
		})
		.catch(() => {
			setNetworkState(NETWORK_OFFLINE)
			return NETWORK_OFFLINE
		})
		.finally(() => {
			clearTimeout(timeout)
			initialCheck = null
		})

	return initialCheck
}

export const ensureNetworkState = config => {
	if (networkSnapshot.status !== NETWORK_UNKNOWN) return Promise.resolve(networkSnapshot.status)
	return initializeNetworkState(config)
}

export const startNetworkStateMonitoring = config => {
	if (!config?.url || !config?.query) {
		initializeNetworkState(config)
		return () => { }
	}

	initializeNetworkState(config)

	const appStateSubscription = AppState.addEventListener('change', nextState => {
		if (nextState === 'active') initializeNetworkState(config)
	})

	return () => appStateSubscription.remove()
}
