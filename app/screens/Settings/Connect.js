import React from 'react'
import { Text, View, ScrollView, Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Icon from 'react-native-vector-icons/FontAwesome'

import { useConfig, useSetConfig } from '~/contexts/config'
import { useNetwork } from '~/contexts/network'
import { confirmAlert } from '~/utils/alert'
import { NETWORK_ONLINE } from '~/utils/networkState'
import { useSettings, useSetSettings, demoServers } from '~/contexts/settings'
import { useSongDispatch } from '~/contexts/song'
import { useTheme } from '~/contexts/theme'
import ButtonText from '~/components/settings/ButtonText'
import Header from '~/components/Header'
import mainStyles from '~/styles/main'
import OptionsPopup from '~/components/popup/OptionsPopup'
import settingStyles from '~/styles/settings'
import size from '~/styles/size'
import TableItem from '~/components/settings/TableItem'
import Player from '~/utils/player'

const Connect = ({ navigation }) => {
	const { t } = useTranslation()
	const insets = useSafeAreaInsets()
	const config = useConfig()
	const setConfig = useSetConfig()
	const settings = useSettings()
	const setSettings = useSetSettings()
	const theme = useTheme()
	const songDispatch = useSongDispatch()
	const [serverOption, setServerOption] = React.useState(null)
	const network = useNetwork()

	const upConfig = (conf) => {
		AsyncStorage.setItem('config', JSON.stringify(conf))
		setConfig(conf)
		Player.resetAudio(songDispatch)
	}

	return (
		<ScrollView
			style={mainStyles.mainContainer(theme)}
			contentContainerStyle={mainStyles.contentMainContainer(insets)}
		>
			<Header title={t("Connect")} />
			<View style={settingStyles.contentMainContainer}>
				<View style={settingStyles.optionsContainer(theme)}>
					<View style={{ flexDirection: 'column', alignItems: 'center', width: '100%', minHeight: 60, marginTop: 20, paddingBottom: 20 }}>
						<View
							style={{
								aspectRatio: 1,
								backgroundColor: theme.primaryTouch,
								borderRadius: 5,
								alignItems: 'center',
								justifyContent: 'center',
								padding: 10,
							}}>
							<Icon name="server" size={size.icon.large} color={theme.innerTouch} />
						</View>
						<View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10 }}>
							<Icon name="circle" size={10} color={network.status === NETWORK_ONLINE ? 'green' : 'red'} />
							<Text style={{ color: theme.primaryText, fontSize: size.text.medium, marginStart: 5 }}>
								{(() => {
									if (network.status === NETWORK_ONLINE && network.serverInfo) return `${network.serverInfo.type.charAt(0).toUpperCase()}${network.serverInfo.type.slice(1)} ${network.serverInfo.serverVersion}`
									else return t('Not connected')
								})()}
							</Text>
						</View>
					</View>
				</View>
				{config.url && (
					<>
						<Text style={settingStyles.titleContainer(theme)}>{t('settings.connect.Current server')}</Text>
						<View style={settingStyles.optionsContainer(theme)}>
							<TableItem title={t("Name")} value={config.name} />
							<TableItem title={t("Url")} value={config.url} />
							<TableItem title={t("Username")} value={config.username} isLast />
						</View>
					</>
				)}
				<Text style={settingStyles.titleContainer(theme)}>{t('settings.connect.List of servers')}</Text>
				<View style={settingStyles.optionsContainer(theme)}>
					{
						settings?.servers?.map((server, index) => (
							<Pressable
								key={index}
								style={({ pressed }) => ([mainStyles.opacity({ pressed }), settingStyles.optionItem(theme, true)])}
								onPress={() => {
									upConfig(server)
								}}
								delayLongPress={200}
								onLongPress={() => setServerOption({ ...server, index })}
								onContextMenu={(ev) => {
									ev.preventDefault()
									setServerOption({ ...server, index })
								}}
							>
								<Icon name="server" size={size.icon.tiny} color={theme.secondaryText} style={{ marginEnd: 10 }} />
								<Text numberOfLines={1} style={[mainStyles.mediumText(theme.primaryText), { marginRight: 10, textTransform: 'uppercase', flex: 1, overflow: 'hidden' }]}>
									{server.name?.length ? server.name : server.url}
								</Text>
								{(server.query === config.query && server.url === config.url && config.name === server.name) && <Icon name="check" size={size.icon.tiny} color={theme.primaryTouch} />}
							</Pressable>
						))
					}
					<Pressable
						style={({ pressed }) => ([mainStyles.opacity({ pressed }), settingStyles.optionItem(theme, true)])}
						delayLongPress={3000}
						onPress={() => { navigation.navigate('Settings/AddServer') }}
						// Add demo server for testing purposes
						onLongPress={() => {
							setSettings({
								...settings,
								servers: [
									...settings.servers,
									...demoServers.filter((server) => !settings.servers.some((s) => s.name === server.name))
								]
							})
						}}
					>
						<Icon name="plus" size={size.icon.tiny} color={theme.secondaryText} style={{ marginEnd: 10 }} />
						<Text numberOfLines={1} style={{ color: theme.primaryText, fontSize: size.text.medium, marginRight: 10, textTransform: 'uppercase', flex: 1, overflow: 'hidden' }}>
							{t('settings.connect.Add server')}
						</Text>
					</Pressable>
				</View>
			</View>
			<ButtonText
				text={t("Disconnect")}
				onPress={() => {
					upConfig({ url: null, username: null, query: null })
				}} />
			<OptionsPopup
				options={[
					{
						name: t('settings.connect.Delete'),
						icon: 'trash',
						onPress: () => {
							confirmAlert(
								t('settings.connect.Alert Delete Title'),
								t('settings.connect.Alert Delete Message'),
								() => {
									setSettings({ ...settings, servers: settings.servers.filter((server, index) => index !== serverOption.index) })
									setServerOption(null)
								})
						}
					},
				]}
				visible={serverOption !== null}
				close={() => setServerOption(null)}
			/>

		</ScrollView>
	)
}

export default Connect
