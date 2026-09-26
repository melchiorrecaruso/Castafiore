import React from 'react'
import { Text, View, ScrollView, StyleSheet, Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import { useConfig } from '~/contexts/config'
import { getApi, getApiNetworkFirst } from '~/utils/api'
import { playSong } from '~/utils/player'
import { useSettings } from '~/contexts/settings'
import { useSongDispatch } from '~/contexts/song'
import { useTheme } from '~/contexts/theme'
import RotateIconButton from '~/components/button/RotateIconButton'
import HorizontalList from '~/components/lists/HorizontalList'
import mainStyles from '~/styles/main'
import size from '~/styles/size'
import { initializeNetworkState } from '~/utils/networkState'

const Home = () => {
	const { t } = useTranslation()
	const insets = useSafeAreaInsets()
	const songDispatch = useSongDispatch()
	const config = useConfig()
	const settings = useSettings()
	const theme = useTheme()
	const [statusRefresh, setStatusRefresh] = React.useState()
	const [refresh, setRefresh] = React.useState(0)

	const clickRandomSong = () => {
		getApiNetworkFirst(config, 'getRandomSongs', 'size=50')
			.then((json) => {
				playSong(config, songDispatch, json.randomSongs.song, 0)
			})
			.catch(() => { })
	}

	const refreshLists = () => {
		setRefresh(value => value + 1)
	}

	const forceRefresh = async (rotate = () => { }) => {
		if (typeof rotate === 'function') rotate()
		await initializeNetworkState(config)
		refreshLists()
	}

	const getStatusRefresh = () => {
		getApi(config, 'getScanStatus')
			.then((json) => {
				if (json.scanStatus.scanning) {
					setTimeout(() => {
						getStatusRefresh()
					}, 1000)
					setStatusRefresh(json.scanStatus)
				} else {
					refreshLists()
					setStatusRefresh()
				}
			})
			.catch(() => { })
	}

	const refreshServer = async () => {
		await initializeNetworkState(config)
		refreshLists()
		getApi(config, 'startScan', 'fullScan=true')
			.then(() => {
				getStatusRefresh()
			})
			.catch(() => { })
	}

	return (
		<ScrollView vertical={true}
			style={mainStyles.mainContainer(theme)}
			contentContainerStyle={mainStyles.contentMainContainer(insets)}
		>
			<View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', margin: 20 }}>
				<Pressable
					style={({ pressed }) => ([mainStyles.opacity({ pressed }), styles.boxRandom(theme)])}
					onPress={clickRandomSong}>
					<Text style={styles.textRandom(theme)}>{t('Random Song')}</Text>
				</Pressable>
				<View style={{ flexDirection: 'row' }}>
					{statusRefresh ?
						<Pressable onPress={forceRefresh} style={mainStyles.opacity}
						>
							<Text style={mainStyles.subTitle(theme)}>
								{statusRefresh.count}°
							</Text>
						</Pressable> :
						<RotateIconButton
							icon="refresh"
							size={size.icon.large}
							color={theme.primaryText}
							style={{ paddingHorizontal: 10 }}
							onPress={forceRefresh}
							onLongPress={refreshServer}
							delayLongPress={200}
						/>
					}
				</View>
			</View>
			{config?.url && settings?.homeOrderV2?.map(value =>
				<HorizontalList key={value.id} refresh={refresh} {...value} />
			)}
		</ScrollView>
	)
}

const styles = StyleSheet.create({
	boxRandom: theme => ({
		backgroundColor: theme.secondaryTouch,
		alignItems: 'center',
		padding: 7,
		paddingHorizontal: 15,
		justifyContent: 'center',
		borderRadius: size.radius.circle,
	}),
	textRandom: theme => ({
		fontSize: 18,
		color: theme.innerTouch,
		fontWeight: 'bold',
	}),
})

export default Home
