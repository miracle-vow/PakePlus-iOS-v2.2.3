//
//  WebView.swift
//  PakePlus
//
//  Created by Song on 2025/3/30.
//

import SwiftUI
import WebKit
import AVFoundation

struct WebView: UIViewRepresentable {
    // wkwebview url
    let webUrl: URL
    // is debug
    let debug: Bool
    // on load finished
    let onLoadFinished: (() -> Void)?
    // userAgent
    let userAgent = Bundle.main.object(forInfoDictionaryKey: "USERAGENT") as? String ?? ""

    func makeUIView(context: Context) -> WKWebView {
        let webConfiguration = WKWebViewConfiguration()
        webConfiguration.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        webConfiguration.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        webConfiguration.allowsInlineMediaPlayback = true
        webConfiguration.allowsPictureInPictureMediaPlayback = true
        // enable developer extras
        if #available(iOS 16.4, *) {
            webConfiguration.preferences.setValue(true, forKey: "developerExtrasEnabled")
        } else {
            webConfiguration.preferences.setValue(true, forKey: "developerExtrasEnabled")
            UserDefaults.standard.set(true, forKey: "WebKitDeveloperExtras")
        }
        // creat wkwebview
        let webView = WKWebView(frame: .zero, configuration: webConfiguration)
        webView.uiDelegate = context.coordinator
        webView.navigationDelegate = context.coordinator
        // JS bridge: blob 下载
        webView.configuration.userContentController.add(context.coordinator, name: "blobDownload")

        // debug script
        if debug, let debugScript = WebView.loadJSFile(named: "vConsole") {
            let fullScript = debugScript + "\nvar vConsole = new window.VConsole();"
            let userScript = WKUserScript(
                source: fullScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
            webView.configuration.userContentController.addUserScript(userScript)
            if #available(iOS 16.4, *) {
                webView.isInspectable = true
            }
        }
        // config userAgent
        if !userAgent.isEmpty {
            webView.customUserAgent = userAgent
        }

        // disable double tap zoom
        let script = """
            var meta = document.createElement('meta');
            meta.name = 'viewport';
            meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
            document.head.appendChild(meta);
        """
        let scriptInjection = WKUserScript(source: script, injectionTime: .atDocumentEnd, forMainFrameOnly: false)
        webView.configuration.userContentController.addUserScript(scriptInjection)

        // load custom script
        if let customScript = WebView.loadJSFile(named: "custom") {
            let userScript = WKUserScript(
                source: customScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
            webView.configuration.userContentController.addUserScript(userScript)
        }

        if webUrl.host?.contains("pakeplus.com") == true {
            // load html file
            if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
                webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
            }
        } else {
            // load url
            webView.load(URLRequest(url: webUrl))
        }

        // delegate 设置

        // Add gesture recognizers
        let rightSwipeGesture = UISwipeGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleRightSwipe(_:)))
        rightSwipeGesture.direction = .right
        webView.addGestureRecognizer(rightSwipeGesture)

        let leftSwipeGesture = UISwipeGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleLeftSwipe(_:)))
        leftSwipeGesture.direction = .left
        webView.addGestureRecognizer(leftSwipeGesture)

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    // add coordinator to prevent zoom
    func makeCoordinator() -> Coordinator {
        Coordinator(onLoadFinished: onLoadFinished)
    }
}

// swifui coordinator
class Coordinator: NSObject, UIScrollViewDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private let onLoadFinished: (() -> Void)?
    private var didFinishMainFrameOnce = false

    // init
    init(onLoadFinished: (() -> Void)?) {
        self.onLoadFinished = onLoadFinished
        super.init()
    }

    // blob download state
    private struct BlobDownloadState {
        var filename: String
        var mimeType: String
        var totalChunks: Int
        var receivedChunkIndexes: Set<Int>
        var buffer: Data
    }

    // blob downloads
    private var blobDownloads: [String: BlobDownloadState] = [:]

    // disable zoom
    func viewForZooming(in scrollView: UIScrollView) -> UIView? {
        // disable zoom
        return nil
    }

    // Handle right swipe gesture
    @objc func handleRightSwipe(_ gesture: UISwipeGestureRecognizer) {
        if let webView = gesture.view as? WKWebView, webView.canGoBack {
            webView.goBack()
        }
    }

    // Handle left swipe gesture
    @objc func handleLeftSwipe(_ gesture: UISwipeGestureRecognizer) {
        if let webView = gesture.view as? WKWebView, webView.canGoForward {
            webView.goForward()
        }
    }

    // MARK: - WKNavigationDelegate

    // intercept navigation, recognize common file types and trigger download
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        // only trigger download when user clicks link, other navigation load normally
        if navigationAction.navigationType == .linkActivated, shouldDownload(url: url) {
            decisionHandler(.cancel)
            downloadFile(from: url)
            return
        }

        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // only respond to main frame, and only trigger once, avoid iframe / multiple redirects causing repeated hiding
        guard !didFinishMainFrameOnce else { return }
        didFinishMainFrameOnce = true

        DispatchQueue.main.async { [onLoadFinished] in
            onLoadFinished?()
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        // avoid certain loading failures causing it to stay on the launch screen/loading
        guard !didFinishMainFrameOnce else { return }
        didFinishMainFrameOnce = true

        DispatchQueue.main.async { [onLoadFinished] in
            onLoadFinished?()
        }
    }

    // MARK: - media (camera / microphone) permissions

    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        // if app has already got the camera/microphone permission from system layer, directly authorize the web, no need to show web permission popup
        if hasAppMediaPermission(for: type) {
            decisionHandler(.grant)
        } else {
            // if app doesn't have the corresponding permission, keep default behavior (system decides whether to show popup)
            decisionHandler(.prompt)
        }
    }

    /// check if app has already got the corresponding system media permission
    private func hasAppMediaPermission(for type: WKMediaCaptureType) -> Bool {
        let videoAuthorized = AVCaptureDevice.authorizationStatus(for: .video) == .authorized
        let audioAuthorized = AVCaptureDevice.authorizationStatus(for: .audio) == .authorized

        switch type {
        case .camera:
            return videoAuthorized
        case .microphone:
            return audioAuthorized
        case .cameraAndMicrophone:
            return videoAuthorized && audioAuthorized
        @unknown default:
            return false
        }
    }

    // MARK: - WKScriptMessageHandler (blob download bridge)

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "blobDownload" else { return }
        guard let body = message.body as? [String: Any] else { return }

        let action = (body["action"] as? String) ?? ""
        let id = (body["id"] as? String) ?? ""
        if id.isEmpty { return }

        switch action {
        case "start":
            let filename = sanitizeFilename((body["filename"] as? String) ?? "download")
            let mimeType = (body["mimeType"] as? String) ?? ""
            let totalChunks = max(1, (body["totalChunks"] as? Int) ?? 1)
            blobDownloads[id] = BlobDownloadState(
                filename: filename,
                mimeType: mimeType,
                totalChunks: totalChunks,
                receivedChunkIndexes: [],
                buffer: Data()
            )
            showDownloadStartedHint()

        case "chunk":
            guard var state = blobDownloads[id] else { return }
            guard let index = body["index"] as? Int else { return }
            guard let base64 = body["data"] as? String else { return }

            // prevent duplicate chunk
            if state.receivedChunkIndexes.contains(index) { return }
            guard let chunkData = Data(base64Encoded: base64) else { return }

            state.buffer.append(chunkData)
            state.receivedChunkIndexes.insert(index)
            blobDownloads[id] = state

        case "finish":
            guard let state = blobDownloads[id] else { return }
            blobDownloads.removeValue(forKey: id)

            // only save when all chunks are received
            guard state.receivedChunkIndexes.count >= state.totalChunks else { return }
            saveAndShareBlobData(state.buffer, filename: state.filename)

        case "error":
            blobDownloads.removeValue(forKey: id)
            if let msg = body["message"] as? String, !msg.isEmpty {
                print("blob download failed: \(msg)")
            }

        default:
            return
        }
    }

    private func sanitizeFilename(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "download" }
        // remove path separator, avoid writing file exception
        return trimmed
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
    }

    private func saveAndShareBlobData(_ data: Data, filename: String) {
        let fileManager = FileManager.default
        let tempDir = fileManager.temporaryDirectory
        let destinationURL = tempDir.appendingPathComponent(filename)

        try? fileManager.removeItem(at: destinationURL)
        do {
            try data.write(to: destinationURL, options: [.atomic])
        } catch {
            print("save blob file failed: \(error.localizedDescription)")
            return
        }

        DispatchQueue.main.async { [weak self] in
            self?.presentShareSheet(for: destinationURL)
        }
    }


    /// check if url is a common file type that needs to be downloaded
    private func shouldDownload(url: URL) -> Bool {
        let pathExtension = url.pathExtension.lowercased()
        if pathExtension.isEmpty {
            return false
        }

        let downloadableExtensions: Set<String> = [
            // 图片
            "png", "jpg", "jpeg", "gif", "bmp", "webp", "heic",
            // 视频
            "mp4", "mov", "m4v", "avi", "mkv",
            // 音频
            "mp3", "wav", "aac", "m4a", "flac",
            // 文本/文档
            "txt", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
            // 压缩
            "zip", "rar", "7z"
        ]

        return downloadableExtensions.contains(pathExtension)
    }

    /// 使用 URLSession 下载文件并弹出系统分享面板，让用户保存到「文件」或其他 App
    private func downloadFile(from url: URL) {
        print("start downloading file: \(url.absoluteString)")
        showDownloadStartedHint()
        let task = URLSession.shared.downloadTask(with: url) { [weak self] tempURL, response, error in
            if let error = error {
                print("download failed: \(error.localizedDescription)")
                return
            }

            guard let tempURL = tempURL else {
                print("download failed: temporary file not found")
                return
            }

            // get file name from response or URL
            let suggestedName = (response as? HTTPURLResponse)?
                .allHeaderFields["Content-Disposition"] as? String

            let fileName: String
            if let suggestedName,
               let range = suggestedName.range(of: "filename=") {
                let namePart = String(suggestedName[range.upperBound...]).trimmingCharacters(in: CharacterSet(charactersIn: "\"; "))
                fileName = namePart.isEmpty ? url.lastPathComponent : namePart
            } else {
                fileName = url.lastPathComponent.isEmpty ? "file" : url.lastPathComponent
            }

            let fileManager = FileManager.default
            let tempDir = fileManager.temporaryDirectory
            let destinationURL = tempDir.appendingPathComponent(fileName)

            // if file already exists, remove it
            try? fileManager.removeItem(at: destinationURL)

            do {
                try fileManager.moveItem(at: tempURL, to: destinationURL)
            } catch {
                print("failed to move download file: \(error.localizedDescription)")
                return
            }

            print("download finished, temporary save path: \(destinationURL.path)")

            DispatchQueue.main.async {
                self?.presentShareSheet(for: destinationURL)
            }
        }

        task.resume()
    }

    /// show "start downloading" hint (disappears after 2 seconds)
    private func showDownloadStartedHint() {
        DispatchQueue.main.async {
            guard let window = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .flatMap({ $0.windows })
                .first(where: { $0.isKeyWindow }) else { return }

            let label = UILabel()
            label.text = "start downloading..."
            label.font = .systemFont(ofSize: 15, weight: .medium)
            label.textColor = .white
            label.backgroundColor = .systemBlue
            label.textAlignment = .center
            label.layer.cornerRadius = 8
            label.clipsToBounds = true
            label.alpha = 0

            let padding: CGFloat = 16
            let topMargin: CGFloat = 20
            label.sizeToFit()
            label.frame.size.width += padding * 2
            label.frame.size.height += padding
            let yCenter = window.safeAreaInsets.top + label.frame.height / 2 + topMargin
            label.center = CGPoint(x: window.bounds.midX, y: yCenter)

            window.addSubview(label)

            UIView.animate(withDuration: 0.25, animations: { label.alpha = 1 })
            UIView.animate(withDuration: 0.25, delay: 1.75, options: [], animations: { label.alpha = 0 }) { _ in
                label.removeFromSuperview()
            }
        }
    }

    // present system share sheet, user can choose to save to "file" or share to other apps
    private func presentShareSheet(for fileURL: URL) {
        let activityVC = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
        activityVC.popoverPresentationController?.sourceView = UIApplication.shared.windows.first { $0.isKeyWindow }

        if let topVC = Coordinator.topViewController() {
            topVC.present(activityVC, animated: true, completion: nil)
        } else {
            print("top view controller not found, cannot show share sheet")
        }
    }

    // get current top view controller
    private static func topViewController(base: UIViewController? = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap { $0.windows }
        .first(where: { $0.isKeyWindow })?.rootViewController) -> UIViewController? {

        if let nav = base as? UINavigationController {
            return topViewController(base: nav.visibleViewController)
        }
        if let tab = base as? UITabBarController, let selected = tab.selectedViewController {
            return topViewController(base: selected)
        }
        if let presented = base?.presentedViewController {
            return topViewController(base: presented)
        }
        return base
    }
}

extension WebView {
    // load js file from bundle
    static func loadJSFile(named filename: String) -> String? {
        guard let path = Bundle.main.path(forResource: filename, ofType: "js") else {
            print("Could not find \(filename).js in bundle")
            return nil
        }

        do {
            let jsString = try String(contentsOfFile: path, encoding: .utf8)
            return jsString
        } catch {
            print("Error loading \(filename).js: \(error)")
            return nil
        }
    }
}
