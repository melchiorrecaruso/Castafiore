import React from 'react'
import { View, Image } from 'react-native'
import Icon from 'react-native-vector-icons/FontAwesome'

import size from '~/styles/size'
import { useTheme } from '~/contexts/theme'
import { useSettings } from '~/contexts/settings'
import { cacheCover, getCoverCachedUri } from '~/utils/cache'
import logger from '~/utils/logger'

const ImageMemo = React.memo(Image, (prevProps, nextProps) => {
	return prevProps.source?.uri === nextProps.source?.uri
})

const getCoverArt = uri => {
	const match = uri?.match(/[?&]id=([^&]+)/)
	if (!match) return null
	try {
		return decodeURIComponent(match[1])
	} catch {
		return match[1]
	}
}

const ImageError = ({ source, style = {}, children = null, iconError = null, blurRadius = undefined }) => {
	const [isImage, setIsImage] = React.useState(false)
	const [lastSource, setLastSource] = React.useState({ uri: null })
	const theme = useTheme()
	const settings = useSettings()

	React.useEffect(() => {
		let isMounted = true
		const uri = source?.uri

		if (!uri) {
			setIsImage(false)
			setLastSource(source)
			return () => { isMounted = false }
		}

		const coverArt = getCoverArt(uri)
		if (!coverArt) {
			setLastSource(source)
			setIsImage(true)
			return () => { isMounted = false }
		}
		setIsImage(false)
		setLastSource({ uri: null })

		getCoverCachedUri(coverArt, uri)
			.then(async cachedUri => {
				if (!isMounted) return
				if (cachedUri) {
					setLastSource({ ...source, uri: cachedUri })
					setIsImage(true)
					return
				}
				if (!settings.isCoverCaching) {
					setLastSource(source)
					setIsImage(true)
					return
				}
				const downloadedUri = await cacheCover(uri, coverArt)
				if (!isMounted || !downloadedUri) return
				setLastSource({ ...source, uri: downloadedUri })
				setIsImage(true)
			})
			.catch(error => {
				if (!/failed to connect|network request failed|timed? ?out/i.test(String(error))) {
					logger.error('ImageError', `Unable to cache cover: ${error}`)
				}
			})

		return () => { isMounted = false }
	}, [source?.uri, settings.isCoverCaching])

	if (isImage) return <ImageMemo source={lastSource} onError={() => setIsImage(false)} style={style} blurRadius={blurRadius} />
	if (children) return children
	if (iconError) return (
		<View style={[{ justifyContent: 'center', alignItems: 'center' }, style]}>
			<Icon name={iconError} size={size.icon.large} color={theme.primaryText} />
		</View>
	)
	return (
		<Image
			source={require('~/../assets/foreground-icon.png')}
			style={style}
		/>
	)
}

export default ImageError
