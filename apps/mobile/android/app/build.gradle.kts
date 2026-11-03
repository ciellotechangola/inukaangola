import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Assinatura de release: lida de `android/key.properties` (que não vai para o
// repositório). Sem esse ficheiro o build continua a funcionar, assinado com as
// chaves de debug — serve para testar, não para distribuir.
val chaveProperties = Properties()
val chavePropertiesFile = rootProject.file("key.properties")
val temChaveDeRelease = chavePropertiesFile.exists()
if (temChaveDeRelease) {
    FileInputStream(chavePropertiesFile).use { chaveProperties.load(it) }
}

android {
    namespace = "com.inuka.angola.inuka_mobile"
    compileSdk = flutter.compileSdkVersion
    // NDK 27 em vez do 26.3 que o Flutter traz por omissão: os plugins
    // (image_picker, shared_preferences, connectivity_plus, app_links,
    // url_launcher, flutter_plugin_android_lifecycle) pedem 27 e são
    // retrocompatíveis. Com 26.3 o Gradle avisa em cada build.
    ndkVersion = "27.0.12077973"

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_11.toString()
    }

    defaultConfig {
        applicationId = "com.inuka.angola.inuka_mobile"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (temChaveDeRelease) {
            create("release") {
                keyAlias = chaveProperties["keyAlias"] as String
                keyPassword = chaveProperties["keyPassword"] as String
                storeFile = file(chaveProperties["storeFile"] as String)
                storePassword = chaveProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (temChaveDeRelease) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }
}

flutter {
    source = "../.."
}
