// media devices
let inputValue
let resultElement

// listen document loaded
window.addEventListener('DOMContentLoaded', () => {
    inputValue = document.querySelector('#inputValue').value
    resultElement = document.querySelector('#result')
    // open url by js bridge
    document.querySelector('#openUrl')?.addEventListener('click', async (e) => {
        e.preventDefault()
        console.log('open url')
        if (window.JsBridge) {
            window.JsBridge.openUrl(
                inputValue ? inputValue : 'https://juejin.cn/'
            )
        } else {
            window.open(
                inputValue ? inputValue : 'https://juejin.cn/',
                '_blank'
            )
        }
    })
    // is app
    document.querySelector('#isApp')?.addEventListener('click', async (e) => {
        e.preventDefault()
        console.log('is app')
        if (window.JsBridge) {
            const isApp = window.JsBridge.isApp()
            console.log('is app', isApp)
            resultElement.innerHTML = isApp
                ? '当前环境是APP'
                : '当前环境不是APP'
        } else {
            resultElement.innerHTML = '当前环境不是APP'
            return
        }
    })
    // is android
    document
        .querySelector('#isAndroid')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('is android by js bridge')
            if (window.JsBridge) {
                const isAndroid = window.JsBridge.isAndroid()
                console.log('is android', isAndroid)
                resultElement.innerHTML = isAndroid
                    ? '当前环境是Android'
                    : '当前环境不是Android'
            } else {
                resultElement.innerHTML = '当前环境不是Android'
                return
            }
        })
    // downloadImg
    document
        .querySelector('#downloadImg')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('download file')
            const aDom = document.createElement('a')
            aDom.href = inputValue
                ? inputValue
                : 'https://hk.gh-proxy.org/https://github.com/Sjj1024/PakePlus/blob/main/app-icon.png'
            aDom.download = 'app-icon.png'
            aDom.click()
        })
    // downloadAudio
    document
        .querySelector('#downloadAudio')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('download audio')
            const aDom = document.createElement('a')
            aDom.href = inputValue
                ? inputValue
                : 'https://self.pakeplus.com/likeme.mp3'
            aDom.download = 'likeme.mp3'
            aDom.click()
        })
    // downloadVideo
    document
        .querySelector('#downloadVideo')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('download video')
            const aDom = document.createElement('a')
            aDom.href = inputValue
                ? inputValue
                : 'https://gh-proxy.org/https://github.com/worker500/FileHub/blob/main/root/IronMan.mp4'
            aDom.download = 'IronMan.mp4'
            aDom.click()
        })
    // downloadFile
    document
        .querySelector('#downloadFile')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('download file')
            const aDom = document.createElement('a')
            aDom.href = inputValue
                ? inputValue
                : 'https://files.pakeplus.com/dist.zip'
            aDom.download = 'dist.zip'
            aDom.click()
        })
    // ios down img
    document
        .querySelector('#iosDownImg')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('ios down img')
            const response = await fetch(
                'https://hk.gh-proxy.org/https://github.com/Sjj1024/PakePlus/blob/main/app-icon.png'
            )
            const blob = await response.blob()
            const file = new File([blob], 'app-icon.png', { type: 'image/png' })
            // 4. 调用分享 API
            await navigator.share({
                title: '保存图片',
                text: '点击保存到相册',
                files: [file],
            })
        })
    // ios down audio
    document
        .querySelector('#iosDownAudio')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('ios down audio')
            const response = await fetch(
                'https://gh-proxy.org/https://github.com/worker500/FileHub/blob/main/root/likeme.mp3'
            )
            const blob = await response.blob()
            const file = new File([blob], 'likeme.mp3', { type: 'audio/mpeg' })
            // 4. 调用分享 API
            await navigator.share({
                title: '保存音频',
                text: '点击保存到相册',
                files: [file],
            })
        })
    // ios down video
    document
        .querySelector('#iosDownVideo')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('ios down video')
            const response = await fetch(
                'https://gh-proxy.org/https://github.com/worker500/FileHub/blob/main/root/IronMan.mp4'
            )
            const blob = await response.blob()
            const file = new File([blob], 'IronMan.mp4', { type: 'video/mp4' })
            // 4. 调用分享 API
            await navigator.share({
                title: '保存视频',
                text: '点击保存到相册',
                files: [file],
            })
        })
    // ios down file
    document
        .querySelector('#iosDownFile')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('ios down file')
            const response = await fetch('https://files.pakeplus.com/dist.zip')
            const blob = await response.blob()
            const file = new File([blob], 'dist.zip', {
                type: 'application/zip',
            })
            // 4. 调用分享 API
            await navigator.share({
                title: '保存文件',
                text: '点击保存到相册',
                files: [file],
            })
        })
    // audioCapture
    document
        .querySelector('#audioCapture')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('audio capture')
            const audio = document.querySelector('audio')
            audio.play()
        })
    // location
    document.querySelector('#location')?.addEventListener('click', (e) => {
        e.preventDefault()
        if (!navigator.geolocation) {
            resultElement.textContent = '当前环境不支持定位'
            return
        }
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const {
                    latitude,
                    longitude,
                    accuracy,
                    altitude,
                    altitudeAccuracy,
                    heading,
                    speed,
                } = position.coords
                const data = {
                    latitude,
                    longitude,
                    accuracy,
                    altitude,
                    altitudeAccuracy,
                    heading,
                    speed,
                    timestamp: position.timestamp,
                }
                resultElement.textContent = JSON.stringify(data, null, 2)
                console.log('location', data)
            },
            (error) => {
                console.log('location error', error.code, error.message)
                resultElement.textContent = error.message || String(error)
            },
            { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
        )
    })
    // videoCapture
    document
        .querySelector('#videoTest')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('video test')
            // 请求摄像头访问权限
            navigator.mediaDevices
                .getUserMedia({
                    video: true,
                    audio: true,
                })
                .then((stream) => {
                    // 成功获取视频流
                    const videoElement = document.querySelector('#videoCapture')
                    videoElement.srcObject = stream
                    videoElement.play()
                })
                .catch((error) => {
                    console.error('访问摄像头失败:', error)
                })
        })
    // screenCapture
    document
        .querySelector('#screenCapture')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('screen capture')
            const screen = document.querySelector('screen')
            screen.capture()
        })
})
