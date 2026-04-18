// const { invoke } = window.__TAURI__.core
// const { ask, confirm, message, open, save } = window.__TAURI__.dialog
// // file
// const {
//     create,
//     writeTextFile,
//     writeFile,
//     readTextFile,
//     BaseDirectory,
//     readFile,
//     open: openFile,
//     remove,
//     readDir,
//     copyFile,
//     stat,
//     exists,
//     readTextFileLines,
//     rename,
//     truncate,
//     mkdir,
//     watch,
//     watchImmediate,
//     lstat,
//     size,
// } = window.__TAURI__.fs
// // join
// const { join, downloadDir } = window.__TAURI__.path
// // webview window
// const { WebviewWindow } = window.__TAURI__.webviewWindow

// media devices
let resultElement

const appAction = () => {
    // set window title
    document
        .querySelector('#setWindowTitle')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('set window title')
            const { getCurrentWindow } = window.__TAURI__.window
            const currentWin = getCurrentWindow()
            await currentWin.setTitle('PakePlus-test')
        })
    document.querySelector('#hide')?.addEventListener('click', async (e) => {
        e.preventDefault()
        console.log('hide')
        const { hide } = window.__TAURI__.app
        await hide()
    })
    document.querySelector('#show')?.addEventListener('click', async (e) => {
        e.preventDefault()
        console.log('show')
        const { show } = window.__TAURI__.app
        await show()
    })
    // maximize
    document
        .querySelector('#maximize')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('maximize')
            const { getCurrentWindow } = window.__TAURI__.window
            const currentWin = getCurrentWindow()
            await currentWin.maximize()
        })
    // unmaximize
    document
        .querySelector('#unmaximize')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('unmaximize')
            const { getCurrentWindow } = window.__TAURI__.window
            const currentWin = getCurrentWindow()
            await currentWin.unmaximize()
        })
    // toggleMaximize
    document
        .querySelector('#toggleMaximize')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('toggleMaximize')
            const { getCurrentWindow } = window.__TAURI__.window
            const currentWin = getCurrentWindow()
            await currentWin.toggleMaximize()
        })
    // minimize
    document
        .querySelector('#minimize')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('minimize')
            const { getCurrentWindow } = window.__TAURI__.window
            const currentWin = getCurrentWindow()
            await currentWin.minimize()
        })
    // unminimize
    document
        .querySelector('#unminimize')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('unminimize')
            const { getCurrentWindow } = window.__TAURI__.window
            const currentWin = getCurrentWindow()
            await currentWin.unminimize()
        })
    // exit
    document.querySelector('#exit')?.addEventListener('click', async (e) => {
        e.preventDefault()
        console.log('exit')
        const { exit } = window.__TAURI__.process
        await exit()
    })
    // relaunch
    document
        .querySelector('#relaunch')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('relaunch')
            const { relaunch } = window.__TAURI__.process
            await relaunch()
        })
}

// listen document loaded
window.addEventListener('DOMContentLoaded', () => {
    resultElement = document.querySelector('#result')
    appAction()
    // open url
    document.querySelector('#openUrl')?.addEventListener('click', async (e) => {
        e.preventDefault()
        console.log('open url')
        const inputValue = document.querySelector('#inputValue').value
        const { invoke } = window.__TAURI__.core
        await invoke('open_url', {
            url: inputValue ? inputValue : 'https://juejin.cn/',
        })
    })
    // run command
    document
        .querySelector('#runCommand')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('run command')
            const { invoke } = window.__TAURI__.core
            const inputValue = document.querySelector('#inputValue').value
            const result = await invoke('run_command', {
                command: inputValue ? inputValue : 'node -v',
            })
            console.log('result', result)
            resultElement.textContent = result
        })
    // download file
    document
        .querySelector('#downloadFile')
        .addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('download file')
            const { invoke } = window.__TAURI__.core
            const inputValue = document.querySelector('#inputValue').value
            const result = await invoke('download_file', {
                url: inputValue
                    ? inputValue
                    : 'https://hk.gh-proxy.org/https://github.com/Sjj1024/PakePlus/blob/main/app-icon.png',
                savePath: '',
                fileId: '1111',
            })
            console.log('result', result)
            resultElement.textContent = result
        })
    // get exe dir
    document
        .querySelector('#getExeDir')
        .addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('get exe dir')
            const { invoke } = window.__TAURI__.core
            const result = await invoke('get_exe_dir')
            console.log('result', result)
            resultElement.textContent = result
        })
    // get env var
    document
        .querySelector('#getEnvVar')
        .addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('get env var')
            const inputValue = document.querySelector('#inputValue').value
            const { invoke } = window.__TAURI__.core
            const result = await invoke('get_env_var', {
                name: inputValue ? inputValue : 'PATH',
            })
            console.log('result', result)
            resultElement.textContent = result
        })
    // find port
    document.querySelector('#findPort').addEventListener('click', async (e) => {
        e.preventDefault()
        console.log('find port')
        const { invoke } = window.__TAURI__.core
        const result = await invoke('find_port')
        console.log('result', result)
        resultElement.textContent = result
    })
    // open url new
    document
        .querySelector('#openUrlNew')
        .addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('open url new')
            const inputValue = document.querySelector('#inputValue').value
            const { WebviewWindow } = window.__TAURI__.webviewWindow
            const webview = new WebviewWindow('my-label', {
                url: inputValue ? inputValue : 'https://pakeplus.com/',
                center: true,
                width: 800,
                height: 400,
                focus: true,
                title: 'PakePlus Window',
            })
            webview.once('tauri://created', function () {
                console.log('new webview created')
            })
            webview.once('tauri://error', function (e) {
                console.log('new webview error', e)
            })
        })
    // open dialog
    document
        .querySelector('#openAskDialog')
        .addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('open dialog')
            const { ask } = window.__TAURI__.dialog
            const answer = await ask(
                'This action cannot be reverted. Are you sure?',
                {
                    title: 'PakePlus',
                    kind: 'warning',
                }
            )
            console.log('answer', answer)
            resultElement.textContent = answer
        })

    // open confirm dialog
    document
        .querySelector('#openConfirmDialog')
        .addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('open confirm dialog')
            const { confirm } = window.__TAURI__.dialog
            const answer = await confirm(
                'This action cannot be reverted. Are you sure?',
                {
                    title: 'PakePlus',
                    kind: 'warning',
                }
            )
            console.log('answer', answer)
            resultElement.textContent = answer
        })

    // open message dialog
    document
        .querySelector('#openMessageDialog')
        .addEventListener('click', async (e) => {
            e.preventDefault()
            const { message } = window.__TAURI__.dialog
            await message('File not found', {
                title: 'PakePlus',
                kind: 'error',
            })
        })

    // open file dialog
    document
        .querySelector('#openFileDialog')
        .addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('open file dialog')
            // Open a dialog
            const { open } = window.__TAURI__.dialog
            const file = await open({
                multiple: false,
                directory: false,
            })
            console.log('file', file)
            resultElement.textContent = file
        })
    // open directory dialog
    document
        .querySelector('#openDirDialog')
        .addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('open directory dialog')
            const { open } = window.__TAURI__.dialog
            const file = await open({
                multiple: false,
                directory: true,
            })
            console.log('file', file)
            resultElement.textContent = file
        })

    // open save dialog
    document
        .querySelector('#openSaveDialog')
        .addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('open save dialog')
            const { save } = window.__TAURI__.dialog
            const path = await save({
                filters: [
                    {
                        name: 'filesave',
                        extensions: ['png', 'jpeg'],
                    },
                ],
            })
            console.log('path', path)
            resultElement.textContent = path
        })
    // create file
    document
        .querySelector('#createFile')
        .addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('create file')
            const { create, BaseDirectory } = window.__TAURI__.fs
            const file = await create('pakeplus.txt', {
                baseDir: BaseDirectory.Download,
            })
            await file.write(
                new TextEncoder().encode('Hello PakePlus Create File Test')
            )
            await file.close()
            console.log('file', file)
        })
    // write text file
    document
        .querySelector('#writeTextFile')
        .addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('write text file')
            const { writeTextFile, BaseDirectory } = window.__TAURI__.fs
            const file = await writeTextFile(
                'pakeplus.txt',
                'Hello PakePlus Write Text File Test',
                {
                    baseDir: BaseDirectory.Download,
                }
            )
            console.log('file', file)
            resultElement.textContent = file
        })
    // write binary file
    document
        .querySelector('#writeBinaryFile')
        .addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('write binary file')
            const { writeFile, BaseDirectory } = window.__TAURI__.fs
            // 创建Canvas
            const canvas = document.createElement('canvas')
            canvas.width = 100
            canvas.height = 100
            const ctx = canvas.getContext('2d')

            // 绘制红色方块
            ctx.fillStyle = '#ff0000'
            ctx.fillRect(0, 0, 100, 100)

            // 绘制文字
            ctx.fillStyle = '#ffffff'
            ctx.font = '20px Arial'
            ctx.fillText('PakePlus', 30, 50)

            // 转换为PNG并保存
            const blob = await new Promise((resolve) => {
                canvas.toBlob(resolve, 'image/png', 1.0)
            })

            if (!blob) throw new Error('无法创建Blob')
            const arrayBuffer = await blob.arrayBuffer()
            const uint8Array = new Uint8Array(arrayBuffer)
            console.log('uint8Array11', uint8Array)
            const file = await writeFile('pakeplus_test.png', uint8Array, {
                baseDir: BaseDirectory.Download,
            })
            console.log('file', file)
            resultElement.textContent = file
        })
    // read text file
    document
        .querySelector('#readTextFile')
        .addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('read text file')
            const { readTextFile, BaseDirectory } = window.__TAURI__.fs
            const file = await readTextFile('pakeplus.txt', {
                baseDir: BaseDirectory.Download,
            })
            console.log('file', file)
            resultElement.textContent = file
        })
    // read binary file
    document
        .querySelector('#readBinaryFile')
        .addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('read binary file')
            const { readFile, BaseDirectory } = window.__TAURI__.fs
            const file = await readFile('pakeplus_test.png', {
                baseDir: BaseDirectory.Download,
            })
            console.log('file', file)
            resultElement.textContent = file
        })
    // read file
    document.querySelector('#readFile').addEventListener('click', async (e) => {
        e.preventDefault()
        console.log('read file')
        const { readFile, BaseDirectory } = window.__TAURI__.fs
        const file = await readFile('pakeplus.txt', {
            baseDir: BaseDirectory.Download,
        })
        console.log('file', file)
        resultElement.textContent = file
    })
    // open file
    document.querySelector('#openFile').addEventListener('click', async (e) => {
        e.preventDefault()
        console.log('open file')
        const { open, BaseDirectory } = window.__TAURI__.fs
        const file = await open('pakeplus.txt', {
            read: true,
            baseDir: BaseDirectory.Download,
        })
        console.log('file', file)
        resultElement.textContent = file
        await file.close()
    })
    // read directory
    document.querySelector('#readDir').addEventListener('click', async (e) => {
        e.preventDefault()
        console.log('read directory')
        const { readDir, BaseDirectory } = window.__TAURI__.fs
        const dir = await readDir('pakeplus', {
            baseDir: BaseDirectory.Download,
        })
        console.log('dir', dir)
        resultElement.textContent = dir
    })
    // mkdir
    document.querySelector('#mkdir').addEventListener('click', async (e) => {
        e.preventDefault()
        console.log('mkdir')
        const { mkdir, BaseDirectory } = window.__TAURI__.fs
        const dir = await mkdir('pakeplus', {
            baseDir: BaseDirectory.Download,
        })
        console.log('dir', dir)
        resultElement.textContent = dir
    })
    // watch
    document.querySelector('#watch').addEventListener('click', async (e) => {
        e.preventDefault()
        console.log('watch')
        const { watch, BaseDirectory } = window.__TAURI__.fs
        const watcher = await watch('pakeplus.txt', (event) => {
            console.log('event', event)
        })
        console.log('watcher', watcher)
    })
    // watch immediate
    document
        .querySelector('#watchImmediate')
        .addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('watch immediate')
            const { watchImmediate } = window.__TAURI__.fs
            const watcher = await watchImmediate('pakeplus.txt', (event) => {
                console.log('event', event)
            })
            console.log('watcher', watcher)
        })
    // size
    document.querySelector('#size').addEventListener('click', async (e) => {
        e.preventDefault()
        console.log('size')
        const { size } = window.__TAURI__.fs
        const { join, downloadDir } = window.__TAURI__.path
        const downloadPath = await downloadDir()
        const pptextPath = await join(downloadPath, 'pakeplus.txt')
        console.log('pptextPath', pptextPath)
        const sizeResult = await size(pptextPath)
        console.log('size', sizeResult)
        resultElement.textContent = sizeResult
    })
    // exists
    document.querySelector('#exists').addEventListener('click', async (e) => {
        e.preventDefault()
        console.log('exists')
        const { exists, BaseDirectory } = window.__TAURI__.fs
        const existsResult = await exists('pakeplus.txt', {
            baseDir: BaseDirectory.Download,
        })
        console.log('exists', existsResult)
        resultElement.textContent = existsResult
    })
    // remove
    document.querySelector('#remove').addEventListener('click', async (e) => {
        e.preventDefault()
        console.log('remove')
        const { remove, BaseDirectory } = window.__TAURI__.fs
        const removeRes = await remove('pakeplus.txt', {
            baseDir: BaseDirectory.Download,
        })
        console.log('removeResult', removeRes)
        resultElement.textContent = removeRes
    })
    // copy file
    document.querySelector('#copyFile').addEventListener('click', async (e) => {
        e.preventDefault()
        console.log('copy file')
        const { copyFile, BaseDirectory } = window.__TAURI__.fs
        const copyRes = await copyFile('pakeplus.txt', 'pakeplus_copy.txt', {
            fromPathBaseDir: BaseDirectory.Download,
            toPathBaseDir: BaseDirectory.Download,
        })
        console.log('copyResult', copyRes)
        resultElement.textContent = copyRes
    })
    // rename
    document.querySelector('#rename').addEventListener('click', async (e) => {
        e.preventDefault()
        console.log('rename')
        const { rename, BaseDirectory } = window.__TAURI__.fs
        const renameRes = await rename('pakeplus.txt', 'pakeplus_new.txt', {
            oldPathBaseDir: BaseDirectory.Download,
            newPathBaseDir: BaseDirectory.Download,
        })
        console.log('renameResult', renameRes)
        resultElement.textContent = renameRes
    })
    // truncate
    document
        .querySelector('#truncate')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('truncate')
            const { truncate, BaseDirectory } = window.__TAURI__.fs
            const truncateRes = await truncate('pakeplus.txt', {
                baseDir: BaseDirectory.Download,
            })
            console.log('truncateRes', truncateRes)
            resultElement.textContent = truncateRes
        })
    // video capture
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
                    // 常见错误：
                    // - NotAllowedError: 用户拒绝权限
                    // - NotFoundError: 没有找到摄像头
                    // - NotReadableError: 设备被占用
                })
        })
    // audio test
    document
        .querySelector('#audioTest')
        ?.addEventListener('click', async (e) => {
            e.preventDefault()
            console.log('audio test')
            const audioElement = document.querySelector('#audioCapture')
            audioElement.play()
        })
})

function onFullscreenChange() {
    const isFullscreen =
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement

    console.log('fullscreen change', !!isFullscreen)
}

// 标准
document.addEventListener('fullscreenchange', onFullscreenChange)

// Safari 旧实现
document.addEventListener('webkitfullscreenchange', onFullscreenChange)
