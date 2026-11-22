# J.A.R.V.I.S. — asistente personal local

Aplicación web local en HTML, CSS y JavaScript, con una API Express y memoria personal persistida en SQLite. El perfil, los recuerdos y el historial de chat funcionan sin servicios de IA ni conexiones externas.

## Requisitos

- Node.js 22.12 o posterior, con `node:sqlite`.
- npm.

## Desarrollo

```bash
npm install
npm run dev
```

Abre la dirección local indicada por Vite (habitualmente <http://127.0.0.1:5173>). El servidor API escucha únicamente en `127.0.0.1:3001`; Vite reenvía `/api` al servidor.

Para producción, `npm start` construye la interfaz y la sirve junto con la API en <http://127.0.0.1:3001>.

## Memoria y privacidad

- Al iniciar por primera vez, crea una contraseña maestra de al menos 12 caracteres. No existe recuperación automática: si se pierde la contraseña, los recuerdos cifrados no se pueden leer.
- Los valores del perfil, los recuerdos y el chat se cifran con AES-256-GCM usando una clave derivada con scrypt; la autenticación usa una comparación de verificador derivado. La contraseña y la clave no se escriben en la base de datos. El archivo SQLite queda en `data/jarvis.sqlite` (se puede cambiar con `JARVIS_DB_PATH`).
- La API acepta conexiones de loopback y exige la contraseña para consultar o modificar datos. Las sesiones son cookies `HttpOnly`, `SameSite=Strict`, de hasta ocho horas; el botón **Bloquear** las invalida. Tras cinco intentos de contraseña fallidos se impone una pausa de un minuto.
- Categoría, identificadores y fechas de actividad siguen visibles en SQLite; el contenido de los campos, los recuerdos y el chat está cifrado. Protege también tu cuenta de Windows y no compartas ni copies la base de datos sin protegerla.
- La información permanece en este equipo y en esta instalación. No sincronices ni subas el archivo de datos a repositorios o servicios en la nube.
- El historial anterior de JARVIS se importa después del inicio de sesión; el dato del navegador solo se elimina cuando la copia cifrada se ha guardado correctamente.
- JARVIS solicita confirmación antes de almacenar algunos datos sensibles. **Borrar todos mis datos** elimina el perfil, los recuerdos, el chat y el registro de actividad; no se puede deshacer. También se puede borrar un recuerdo individual desde el panel.

## Comandos de memoria

- `mi nombre es Ana` o `me llamo Ana`
- `mi apodo es Ani`
- `nací el 12/03/1990` (también se acepta `1990-03-12`)
- `mi ciudad es La Paz`, `mi país es Bolivia`, `trabajo como médica`
- `hablo español e inglés`
- `recuerda que mi comida favorita es la pasta`
- `¿cómo me llamo?`, `¿cuándo es mi cumpleaños?`, `¿cuántos años tengo?`
- `muéstrame mi perfil`
- `olvida comida favorita` (se confirma antes de borrar). Para borrar un recuerdo específico ambiguo, usa **Eliminar** en el panel.

También se pueden añadir, editar y eliminar datos desde el panel. El perfil calcula la edad a partir de la fecha de nacimiento.

La interfaz web se organiza en `index.html`, `styles.css` y `app.js`, con pestañas de Interactuar, Perfil, Memoria y Actividad. Actividad registra consultas, apertura de enlaces, análisis de archivos y cambios en recuerdos, sin guardar el texto de los comandos ni el contenido privado; se puede actualizar desde esa sección. Al guardar desde el formulario de Memoria aparece una confirmación discreta que se oculta automáticamente.

Desde Perfil se puede configurar una API Key de Gemini u OpenAI. La clave queda en el `localStorage` del navegador (se puede borrar desde el panel); por ello, no la uses en un equipo compartido ni en un sitio expuesto. El permiso para enviar mensajes recientes y el archivo adjunto es independiente y debe activarse explícitamente. La memoria y el perfil no se incluyen en las solicitudes a IA. Para responder investigaciones con conceptos actuales y fuentes, seleccione Gemini, configure una clave y autorice el envío; esta función usa Google Search grounding y puede consumir cuota o generar costos según su plan. Cada investigación envía únicamente la pregunta, no el historial ni los archivos. Si no está configurado, JARVIS abre la búsqueda web como alternativa.

El núcleo activa reconocimiento de voz en español cuando el navegador lo admite; la voz y las voces masculinas disponibles dependen del sistema operativo y navegador. Los archivos de texto y PDF se leen localmente. Su contenido solo sale del equipo si se configuró la IA y se habilitó el consentimiento.

El núcleo visual de JARVIS inicia apagado. En **Interactuar**, activa la detección de aplausos y concede permiso al micrófono; después, un aplauso fuerte enciende el núcleo e inicia el reconocimiento de voz. El detector permanece activo hasta desactivarlo o cerrar/bloquear la aplicación. También puedes pulsar el núcleo para encenderlo y hablar, o apagarlo. Esta función necesita que la página siga abierta en un navegador compatible y una dirección local o segura.

El asistente conserva, además, sus herramientas originales: saludos, hora, fecha, calculadora, apertura de Google/YouTube, voz, micrófono e historial de conversación. Los comandos `busca ...`, `investiga ...`, `consulta ...`, `averigua ...`, `explica ...`, `define ...` y preguntas como `¿qué es ...?` generan una explicación fundamentada en Google Search cuando Gemini está configurado y autorizado; en caso contrario, abren resultados web y explican cómo habilitar la respuesta con fuentes. La página no puede explorar unidades de Windows ni ejecutar comandos del sistema; para leer archivos se debe usar **Adjuntar archivo** y elegirlos explícitamente.

Para compartir el proyecto en GitHub, no subas `data/`, que contiene la base de datos personal cifrada. `.gitignore` excluye la base de datos y sus archivos auxiliares.

## Verificación

```bash
npm test
npm run lint
npm run build
```
