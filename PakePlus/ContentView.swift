//
//  ContentView.swift
//  PakePlus
//
//  Created by Song on 2025/3/29.
//

import SwiftUI

struct ContentView: View {
    // read value from info
    let webUrl = Bundle.main.object(forInfoDictionaryKey: "WEBURL") as? String ?? ""
    let debug = Bundle.main.object(forInfoDictionaryKey: "DEBUG") as? Bool ?? false
    let fullScreen = Bundle.main.object(forInfoDictionaryKey: "FULLSCREEN") as? Bool ?? false
    let launchImage = Bundle.main.object(forInfoDictionaryKey: "LAUNCHIMAGE") as? Bool ?? false
    
    @State private var isWebLoaded: Bool = false

    var body: some View {
        // BottomMenuView()
        ZStack {
            // webview
            WebView(
                webUrl: URL(string: webUrl)!,
                debug: debug,
                onLoadFinished: {
                    isWebLoaded = true
                }
            )
            .ignoresSafeArea(edges: [.all])
            .allowsHitTesting(isWebLoaded)
            
            // loading screen
            if !isWebLoaded && launchImage {
                Image("LaunchScreen")
                    .resizable()
                    .scaledToFill()
                    .ignoresSafeArea()
                    .transition(.opacity)
            }
        }
        .statusBarHidden(fullScreen)
    }
}

// #Preview {
//     ContentView()
// }
