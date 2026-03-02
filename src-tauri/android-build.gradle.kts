// ─────────────────────────────────────────────────────────────────
// Onyx — Android app/build.gradle.kts (signing-ready template)
// ─────────────────────────────────────────────────────────────────
// This file is copied over the Tauri-generated build.gradle.kts
// during CI (see .github/workflows/ci.yml). It lives OUTSIDE gen/
// so it is tracked by git (gen/ is gitignored).
// ─────────────────────────────────────────────────────────────────

import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Load keystore config — CI writes keystore.properties, local dev may use key.properties
val keystoreProperties = Properties().apply {
    for (name in listOf("keystore.properties", "key.properties")) {
        val f = rootProject.file(name)
        println("  Keystore: checking ${f.absolutePath} → exists=${f.exists()}")
        if (f.exists()) {
            f.inputStream().use { load(it) }
            println("  Keystore: ✅ loaded from ${f.absolutePath}")
            return@apply
        }
    }
    println("  Keystore: ⚠️ no properties file found — release APK will be unsigned unless apksigner runs post-build")
}

android {
    compileSdk = 36
    namespace = "com.onyxvoid.onyx"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.onyxvoid.onyx"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }

    signingConfigs {
        create("release") {
            val ksPath = keystoreProperties.getProperty("storeFile")
                ?: System.getenv("ANDROID_KEYSTORE_PATH")
            println("  Signing: storeFile=$ksPath")
            if (ksPath != null) {
                storeFile = rootProject.file(ksPath)
                storePassword = keystoreProperties.getProperty("storePassword")
                    ?: System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: ""
                keyAlias = keystoreProperties.getProperty("keyAlias")
                    ?: System.getenv("ANDROID_KEY_ALIAS") ?: ""
                keyPassword = keystoreProperties.getProperty("keyPassword")
                    ?: System.getenv("ANDROID_KEY_PASSWORD") ?: ""
                println("  Signing: ✅ configured — storeFile=${storeFile?.absolutePath}, keyAlias=$keyAlias")
            } else {
                println("  Signing: ⚠️ no storeFile — Gradle will NOT sign the release APK")
            }
        }
    }

    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
        // Suppress upstream Tauri/plugin deprecation warnings we can't fix
        freeCompilerArgs += listOf(
            "-Xsuppress-warning=DEPRECATION",
            "-Xsuppress-warning=UNUSED_PARAMETER"
        )
    }
    // Suppress missing consumer-rules.pro warnings from Tauri plugins
    lintOptions {
        isAbortOnError = false
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")
