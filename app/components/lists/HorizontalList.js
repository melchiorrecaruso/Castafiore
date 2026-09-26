import React from 'react'
import { Pressable, Text } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import Icon from 'react-native-vector-icons/FontAwesome'

import { getApi, getStoredResponse } from '~/utils/api'
import { useTheme } from '~/contexts/theme'
import { useSettings, homeSections } from '~/contexts/settings'
import { useConfig } from '~/contexts/config'
import { useUpdateApi, isUpdatable } from '~/contexts/updateApi'
import { useRefreshOnOffline, useRefreshOnReconnect } from '~/contexts/network'
import HorizontalQueue from '~/components/lists/HorizontalQueue'
import HorizontalAlbums from '~/components/lists/HorizontalAlbums'
import HorizontalArtists from '~/components/lists/HorizontalArtists'
import HorizontalGenres from '~/components/lists/HorizontalGenres'
import HorizontalListeningStat from '~/components/lists/HorizontalListeningStat'
import HorizontalPlaylists from '~/components/lists/HorizontalPlaylists'
import mainStyles from '~/styles/main'
import RadioList from '~/components/lists/RadioList'
import size from '~/styles/size'
import logger from '~/utils/logger'
import { getCachedNavidromeList } from '~/utils/navidromeLists'
import { getLastFmWeeklyActivity } from '~/utils/lastFm'
import { ensureNetworkState, getNetworkState, NETWORK_OFFLINE } from '~/utils/networkState'

const HorizontalList = ({ refresh, id, enable }) => {
	const { t } = useTranslation()
	const [list, setList] = React.useState()
	const theme = useTheme()
	const settings = useSettings()
	const navigation = useNavigation()
	const config = useConfig()
	const updateApi = useUpdateApi()
	const section = React.useMemo(() => homeSections.find(s => s.id === id), [id])
	const responseMode = React.useRef('cache')
	const loadPromise = React.useRef(null)

	const setSectionItems = async (items, mode = responseMode.current) => {
		responseMode.current = mode
		setList(items)
	}

	const loadDatabaseList = async playableOnly => {
		const items = await getCachedNavidromeList(config, section.id, { playableOnly })
		responseMode.current = playableOnly ? 'offline' : 'database'
		if (section.type === 'queue') setList({ current: 0, entry: items || [] })
		else setList(items || [])
	}

	React.useEffect(() => {
		if (!enable || !config.query) return
		getList().catch(error => logger.error('Home section', section?.id, error))
		return () => {
			setList(null)
		}
	}, [config, enable, id])

	React.useEffect(() => {
		if (!enable) return
		if (!refresh) return
		if (config.query) {
			getList().catch(error => logger.error('Home section refresh', section?.id, error))
		}
	}, [refresh])

	React.useEffect(() => {
		if (!enable) return
		if (!section) return
		let nquery = section.query || ''

		if (section.type == 'album') nquery += '&size=' + settings.sizeOfList

		if (isUpdatable(updateApi, section.path, nquery)) {
			getStoredResponse(config, section.path, nquery)
				.then(json => {
					if (!json) return
					section.getInfo(json, items => setSectionItems(items))
				})
		}
	}, [updateApi])

	const loadList = async () => {
		if (!enable || !section) return
		let nquery = section.query ? section.query : ''

		if (section.type == 'album') nquery += '&size=' + settings.sizeOfList
		if (section.type == 'listening_activity') {
			if (config.lastFmStatsEnabled !== true) {
				setList(null)
				return
			}
			try {
				setList(await getLastFmWeeklyActivity(config, config.lastFmUser || config.username))
			} catch (error) {
				logger.error('Last.fm Stats', error)
				setList(error.message)
			}
		} else {
			const networkStatus = await ensureNetworkState(config)
			if (networkStatus !== NETWORK_OFFLINE) {
				try {
					await getApi(config, section.path, nquery)
				} catch (error) {
					logger.error('Home section update', section.id, error)
				}
			}
			await loadDatabaseList(getNetworkState() === NETWORK_OFFLINE)
		}
	}

	const getList = async () => {
		if (loadPromise.current) return loadPromise.current
		const request = loadList()
		loadPromise.current = request
		try {
			return await request
		} finally {
			if (loadPromise.current === request) loadPromise.current = null
		}
	}

	useRefreshOnReconnect(() => {
		getList().catch(error => logger.error('Home section reconnect', section?.id, error))
	})
	useRefreshOnOffline(() => {
		if (!enable || section?.type === 'listening_activity') return
		getList().catch(error => logger.error('Home section offline', section?.id, error))
	})

	if (!enable) return null
	if (!list) return null
	if (list?.length === 0) return null
	return (
		<>
			<Pressable
				style={{
					flexDirection: 'row',
					justifyContent: 'space-between',
					alignItems: 'center',
					width: '100%',
				}}
				disabled={!section.isShowAll}
				onPress={() => { navigation.navigate('ShowAll', { sectionId: section.id }) }}
			>
				<Text numberOfLines={1} style={[mainStyles.titleSection(theme), {
					flex: 1,
					marginEnd: 0,
				}]}>{t(`homeSection.${section.title}`)}</Text>
				{
					section.isShowAll && <Icon
						name='angle-right'
						color={theme.secondaryText}
						size={size.icon.medium}
						style={mainStyles.titleSection(theme)}
					/>
				}
			</Pressable>
			{section.type === 'queue' && <HorizontalQueue current={list.current} queue={list.entry} />}
			{section.type === 'album' && <HorizontalAlbums albums={list} />}
			{section.type === 'album_star' && <HorizontalAlbums albums={list} />}
			{section.type === 'artist' && <HorizontalArtists artists={list} />}
			{section.type === 'artist_all' && <HorizontalArtists artists={list} />}
			{section.type === 'genre' && <HorizontalGenres genres={list} />}
			{section.type === 'radio' && <RadioList radios={list} />}
			{section.type === 'listening_activity' && <HorizontalListeningStat stats={list} />}
			{section.type === 'playlist' && <HorizontalPlaylists playlists={list} />}
		</>
	)
}

export default HorizontalList
