import React from 'react'
import { Text, FlatList, Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'

import { useTheme } from '~/contexts/theme'
import { useConfig } from '~/contexts/config'
import { getApi } from '~/utils/api'
import { parseLrc } from '~/utils/lrc'
import Player from '~/utils/player'
import { getCachedLyrics, saveLyrics } from '~/utils/lyricsCache'
import logger from '~/utils/logger'

const Lyric = ({ song, style, color = null, sizeText = 23 }) => {
	const { t } = useTranslation()
	const [indexCurrent, setIndex] = React.useState(0)
	const [lyrics, setLyrics] = React.useState([])
	const [isLayout, setIsLayout] = React.useState(false)
	const config = useConfig()
	const refScroll = React.useRef(null)
	const theme = useTheme()
	const time = Player.updateTime()

	React.useEffect(() => {
		setLyrics([{ time: 0, text: t('Loading lyrics...') }])
		getLyrics()
	}, [song.songInfo])

	const getLyrics = () => {
		getCachedLyrics(config, song.songInfo.id)
			.then(cached => {
				if (cached) {
					setIsLayout(true)
					setLyrics(cached.lines)
				} else {
					getNavidromeLyrics()
				}
			})
	}

	React.useEffect(() => {
		if (lyrics.length == 0) return
		let index = lyrics.findIndex(ly => ly.time > time.position) - 1
		if (index === -1) index = 0
		if (index === -2) index = lyrics.length - 1
		if (index < 0) return
		if (index !== indexCurrent) {
			setIndex(index)
		}
	}, [time.position, lyrics])

	React.useEffect(() => {
		if (!isLayout) return
		refScroll.current.scrollToIndex({ index: indexCurrent, animated: true, viewOffset: 0, viewPosition: 0.5 })
	}, [indexCurrent, isLayout])

	const getNavidromeLyrics = () => {
		getApi(config, 'getLyricsBySongId', { id: song.songInfo.id })
			.then(res => {
				const available = res.lyricsList?.structuredLyrics || []
				const selected = available.find(item => item.synced && item.line?.length) || available.find(item => item.line?.length)
				if (!selected) {
					return getLrcLibLyrics()
				}
				const offset = selected.offset || 0
				const ly = selected.line.map(line => ({
					time: ((line.start || 0) + offset) / 1000,
					text: line.value?.length ? line.value : '...',
				}))
				ly.sort((a, b) => a.time - b.time)
				setLyrics(ly)
				saveLyrics(config, song.songInfo.id, {
					source: 'navidrome',
					language: selected.lang,
					synced: Boolean(selected.synced),
					offset,
					displayArtist: selected.displayArtist,
					displayTitle: selected.displayTitle,
					lines: ly,
				}).catch(error => logger.error('Lyric', `Unable to save Navidrome lyrics: ${error}`))
			})
			.catch(() => { // If not found
				getLrcLibLyrics()
			})
	}

	const getLrcLibLyrics = () => {
		const params = {
			track_name: song.songInfo.title,
			artist_name: song.songInfo.artist,
			album_name: song.songInfo.album,
			duration: song.songInfo.duration
		}
		fetch('https://lrclib.net/api/get?' + Object.keys(params).map((key) => `${key}=${encodeURIComponent(params[key])}`).join('&'), {
			headers: { 'Lrclib-Client': 'Castafiore' }
		})
			.then(res => res.json())
			.then(res => {
				const ly = parseLrc(res.syncedLyrics)
				setLyrics(ly)
				saveLyrics(config, song.songInfo.id, {
					source: 'lrclib',
					language: res.lang,
					synced: true,
					offset: 0,
					displayArtist: res.artistName,
					displayTitle: res.trackName,
					lines: ly,
				}).catch(error => logger.error('Lyric', `Unable to save LRCLIB lyrics: ${error}`))
			})
			.catch(() => {
				setLyrics([{ time: 0, text: t('No lyrics found') }])
			})
	}

	return (
		<FlatList
			ref={refScroll}
			style={[style, { borderRadius: null }]}
			contentContainerStyle={{ gap: 30 }}
			showsVerticalScrollIndicator={false}
			onScrollToIndexFailed={() => { }}
			initialNumToRender={lyrics.length}
			data={lyrics}
			onLayout={() => setIsLayout(true)}
			keyExtractor={(item, index) => index}
			renderItem={({ item, index }) => {
				return (
					<Pressable
						onPress={() => {
							Player.setPosition(item.time)
						}}
					>
						<Text
							style={{
								color: index === indexCurrent ? color?.active || theme.primaryText : color?.inactive || theme.secondaryText,
								fontSize: sizeText,
								textAlign: 'center',
							}}>
							{item.text.length ? item.text : '...'}
						</Text>
					</Pressable>
				)
			}}
		/>
	)
}

export default Lyric
