import React from 'react'

import { getNetworkSnapshot, subscribeNetworkState } from '~/utils/networkState'
import { NETWORK_OFFLINE, NETWORK_ONLINE } from '~/utils/networkState'


const NetworkContext = React.createContext(getNetworkSnapshot())

export const useNetwork = () => React.useContext(NetworkContext)

export const useRefreshOnReconnect = refresh => {
	const network = useNetwork()
	const previousStatus = React.useRef(network.status)
	const refreshRef = React.useRef(refresh)
	refreshRef.current = refresh

	React.useEffect(() => {
		const oldStatus = previousStatus.current
		previousStatus.current = network.status
		if (oldStatus === NETWORK_OFFLINE && network.status === NETWORK_ONLINE) {
			refreshRef.current()
		}
	}, [network.status])
}

export const useRefreshOnOffline = refresh => {
	const network = useNetwork()
	const previousStatus = React.useRef(network.status)
	const refreshRef = React.useRef(refresh)
	refreshRef.current = refresh

	React.useEffect(() => {
		const oldStatus = previousStatus.current
		previousStatus.current = network.status
		if (oldStatus !== NETWORK_OFFLINE && network.status === NETWORK_OFFLINE) {
			refreshRef.current()
		}
	}, [network.status])
}

export const NetworkProvider = ({ children }) => {
	const network = React.useSyncExternalStore(
		subscribeNetworkState,
		getNetworkSnapshot,
		getNetworkSnapshot,
	)

	return (
		<NetworkContext.Provider value={network}>
			{children}
		</NetworkContext.Provider>
	)
}
