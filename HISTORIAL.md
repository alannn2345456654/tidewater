# Historial de cambios

Notas de lo que se fue agregando al juego. No es parte de las instrucciones, solo para acordarnos.

## Lo básico
- El nivel tiene 3 secciones de 18 columnas. Está hecho con Phaser 3 y no necesita build.
- Cada tapón abre o cierra su desagüe. Las tuberías siempre echan agua, pero solo suben el nivel si todos los tapones de su tramo están puestos.
- Los muros son 36 px más altos que el agua alta, así que el agua nunca los pasa. Con agua alta se puede trepar al muro flotando junto a él.
- El tapón de la derecha del pozo de la sección 2 empieza puesto, para no tener que saltar el pozo. Esto se cambia con la letra `p` en `level.js`.

## Agua (water.js)
- El agua ya no tiene un nivel fijo. Cada columna de 20 px tiene su altura y el agua fluye de lo alto a lo bajo.
- Se puede ajustar con `QIN` (tuberías), `QOUT` (desagües), `G` (velocidad de la ola) y `DAMP` (fricción).
- Un desagüe abierto no se puede tapar mientras pasa mucha agua por encima (`CLOSE_MAX_H`).
- Después de jalar un tapón hay que esperar un momento (`PLUG_LOCK`).

## Personaje
- Salto: `JUMP_V` pasó de -353 a -385 para que se pueda saltar al cangrejo con más margen. No se subió más porque tiene que seguir pasando bajo los pinchos de techo.
- Vida de 2 mitades (`HP_MAX`). El cangrejo quita media y lo demás mata. Después de un golpe hay 1.5 s sin daño (`HURT_MS`).
- Solo nada si el agua está al 35% o más (`SWIM_ENTER`) y deja de nadar abajo del 25% (`SWIM_EXIT`).
- Si se queda quieto en el agua, se para en el agua en vez de nadar.
- Las cajas de daño siguen al dibujo. Se pueden ver con la tecla H.

## Enemigos
- Cangrejo: camina por el suelo, se asusta cuando le llega el agua y levanta las pinzas si te acercas.
- Pelícano: vuela alto. Con agua alta avisa y se lanza en picada.
- Tiburón: está programado pero apagado (`SHARK_ON = false`).
- Si mueres, los enemigos vuelven a su lugar.

## Pistas y sonido
- Los pinchos de techo parpadean cuando el agua está alta y suena un tic al acercarse.
- El sonido y la música se generan con WebAudio, sin archivos. Se pueden bajar o apagar en Ajustes (tecla M).
- Al tocar una bandera se llena la vida y sale un destello.

## Estilo
- Fondo oscuro de túnel de drenaje, con luz alrededor del personaje.
- La decoración no tiene colisión: arcos, rejillas, tuberías viejas, algas, goteras y telarañas.

## Menús
- Pantalla de título y selección de nivel. Por ahora solo está el Tutorial.
- Ajustes con música, efectos, silencio, hitboxes y cronómetro.
- Funciona con teclado, mouse y control (Xbox o PlayStation).

## Opciones por URL (para el experimento de la Actividad 01)
- `?cues=inconsistent`: los peligros cambian de color y forma. Sin esto, todos son rojos.
- `?warn=off`: sin el aviso de los pinchos de techo.
- `?look=color`: colores originales, sin el estilo oscuro.
- `?sound=off`: sin sonido.
- `?debug=hitboxes`: muestra las hitboxes.

## Registro de datos (opcional)
Si se llena `SUPABASE_URL` y `SUPABASE_ANON_KEY` al inicio de `game.js`, los eventos se mandan a Supabase. Si no, se guardan en `localStorage['tidewater_events']`.

Eventos: `session_start`, `plug_pull`, `death`, `hurt`, `gem`, `goal` y `rating`.

Tabla de Supabase:

    create table events (
      id bigint generated always as identity primary key,
      created_at timestamptz default now(),
      session_id text, variant text, type text, data jsonb, t integer
    );
    alter table events enable row level security;
    create policy "anon insert" on events for insert to anon with check (true);

## Cambios para la Actividad 03
- El nivel pasó a un mapa de texto en `level.js`.
- Las constantes de física quedaron juntas al inicio de `game.js`.
- Se quitó el texto del nivel: la "E" del tapón (ahora es un anillo de luz), el aviso de checkpoint y el título del nivel.
- Se agregó el cronómetro opcional en Ajustes.
- Se agregó Vercel Speed Insights en `index.html`. En local da 404 y no afecta al juego.
