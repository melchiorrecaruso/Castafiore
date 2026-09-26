import React from 'react'
import { Text, View, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { useSettings, useSetSettings } from '~/contexts/settings'
import { useConfig, useSetConfig } from '~/contexts/config'
import { useTheme } from '~/contexts/theme'
import { getServerId } from '~/utils/serverIdentity'
import ButtonSwitch from '~/components/settings/ButtonSwitch'
import Header from '~/components/Header'
import HomeOrder from '~/components/settings/HomeOrder'
import OptionInput from '~/components/settings/OptionInput'
import mainStyles from '~/styles/main'
import settingStyles from '~/styles/settings'

const HomeSettings = () => {
	const { t } = useTranslation()
	const insets = useSafeAreaInsets()
	const theme = useTheme()
	const settings = useSettings()
	const setSettings = useSetSettings()
	const config = useConfig()
	const setConfig = useSetConfig()
	const [sizeOfList, setSizeOfList] = React.useState(settings.sizeOfList.toString())
	const [lastFmUser, setLastFmUser] = React.useState(config.lastFmUser || config.username || '')
	const currentServerId = getServerId(config)

	const updateCurrentServer = React.useCallback((patch) => {
		const updatedConfig = { ...config, ...patch }
		AsyncStorage.setItem('config', JSON.stringify(updatedConfig))
		setConfig(updatedConfig)
		setSettings({
			...settings,
			servers: settings.servers.map(server => (
				getServerId(server) === currentServerId ? { ...server, ...patch } : server
			)),
		})
	}, [config, currentServerId, setConfig, setSettings, settings])

	React.useEffect(() => {
		setSizeOfList(settings.sizeOfList.toString())
	}, [settings.sizeOfList])

	React.useEffect(() => {
		if (sizeOfList === '') return
		const number = parseInt(sizeOfList)
		if (number != settings.sizeOfList) setSettings({ ...settings, sizeOfList: number })
	}, [sizeOfList])

	React.useEffect(() => {
		setLastFmUser(config.lastFmUser || config.username || '')
	}, [config.lastFmUser, config.url, config.username])

	React.useEffect(() => {
		if (!config.url || lastFmUser == (config.lastFmUser || config.username || '')) return
		const timeout = setTimeout(() => {
			updateCurrentServer({ lastFmUser })
		}, 1000)
		return () => clearTimeout(timeout)
	}, [config.lastFmUser, config.url, config.username, lastFmUser, updateCurrentServer])

	return (
		<ScrollView
			style={mainStyles.mainContainer(theme)}
			contentContainerStyle={mainStyles.contentMainContainer(insets)}
		>
			<Header title={t("Home")} />
			<View
				style={settingStyles.contentMainContainer}
			>
				<Text style={settingStyles.titleContainer(theme)}>{t('settings.home.Home Page')}</Text>
				<View style={[settingStyles.optionsContainer(theme), { marginBottom: 5 }]}>
					<HomeOrder />
				</View>
				<Text style={settingStyles.description(theme)}>{t('settings.home.Home Page Description')}</Text>
				<View style={settingStyles.optionsContainer(theme)}>
					<OptionInput
						title={t("settings.home.Size of album list")}
						value={sizeOfList}
						onChangeText={(text) => setSizeOfList(text.replace(/[^0-9]/g, ''))}
						inputMode="numeric"
						isLast
					/>
				</View>

				<Text style={settingStyles.titleContainer(theme)}>{t('settings.home.Scroll')}</Text>
				<View style={[settingStyles.optionsContainer(theme), { marginBottom: 5 }]}>
					<ButtonSwitch
						title={t('settings.home.Show scroll helper')}
						onPress={() => setSettings({ ...settings, scrollHelper: !settings.scrollHelper })}
						value={settings.scrollHelper}
						isLast
					/>
				</View>
				<Text style={settingStyles.description(theme)}>	{t('settings.home.Scroll Description')}</Text>

				<Text style={settingStyles.titleContainer(theme)}>{t('settings.home.Last.fm Stats')}</Text>
				<View style={settingStyles.optionsContainer(theme)}>
					<ButtonSwitch
						title={t('settings.home.Enable Last.fm Stats')}
						value={config.lastFmStatsEnabled === true}
						onPress={() => updateCurrentServer({ lastFmStatsEnabled: config.lastFmStatsEnabled !== true })}
					/>
					<OptionInput
						title={t("settings.home.Last.fm User")}
						value={lastFmUser}
						onChangeText={setLastFmUser}
						placeholder={t("settings.home.user")}
						isLast
					/>
				</View>
			</View>
		</ScrollView>
	)
}

export default HomeSettings
