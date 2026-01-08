# Guía de Compilación para Android (.APK)

Esta guía te ayudará a convertir el código en una aplicación para teléfonos Android.

## 1. Instalación de Herramientas (Solo se hace una vez)

1.  **Descargar Android Studio**:
    - Ve a [developer.android.com/studio](https://developer.android.com/studio) y descarga la versión para tu sistema (Windows o Linux).
    - Instálalo y, al abrirlo por primera vez, acepta la instalación del **SDK de Android** y el **Android SDK Platform-Tools**.
2.  **Instalar Java**:
    - Asegúrate de tener instalado Java 17 o superior. (Si instalas Android Studio, él suele traer su propio Java configurado).

---

## 2. Preparación del Proyecto (En la terminal)

Ejecuta estos comandos en la carpeta de tu proyecto (`agenda-viajes`):

1.  **Instalar el soporte para Android**:
    ```bash
    npm install @capacitor/android@6
    ```
2.  **Agregar la plataforma**:
    ```bash
    npx cap add android
    ```
3.  **Preparar el código**:
    - Cada vez que hagas un cambio en los archivos de la app, corre:
    ```bash
    npm run build
    npx cap sync
    ```

---

## 3. Generar el archivo .APK (En Android Studio)

1.  **Abrir el proyecto**:
    ```bash
    npx cap open android
    ```
    *(Si este comando falla, abre Android Studio manualmente y selecciona la carpeta llamada **android** que está dentro de tu proyecto).*
2.  **Sincronización de Gradle**:
    - La primera vez Android Studio bajará archivos. Espera a que la barra de progreso de abajo a la derecha termine.
3.  **Exportar el APK**:
    - En el menú superior ve a: **Build** > **Build Bundle(s) / APK(s)** > **Build APK(s)**.
    - Cuando termine, saldrá un aviso abajo a la derecha. Haz clic en **"locate"**.
    - Se abrirá una carpeta con el archivo `app-debug.apk`. 

**¡Listo!** Ese archivo es el que instalas en el celular del cliente.
