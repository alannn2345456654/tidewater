# Tidewater (prototipo web)

Nivel de 3 secciones x 18 columnas, hecho con Phaser 3 (incluido en `vendor/`). No necesita servidor ni build.

## Probar en local
    npx serve .        # o: python3 -m http.server 8000

## Publicar en Vercel
    npm i -g vercel
    vercel --prod      # en esta carpeta; framework "Other", sin build

## Variantes del experimento
- `?cues=consistent` (por defecto): todos los peligros rojos y con la misma forma.
- `?cues=inconsistent`: color y forma de cada peligro al azar.

## Aviso de pinchos de techo y sonido
- Cuando el agua de una zona con pinchos de techo esta alta (o acaba de subir), los pinchos parpadean en blanco y se enciende su zona de peligro; suena un tic al acercarse. Aplica igual en `consistent` e `inconsistent`.
- `?warn=off`: sin el aviso (version original, util como condicion de control).
- `?sound=off`: sin sonido. Con sonido, la tecla `M` o el boton de arriba a la derecha lo silencia (se recuerda en localStorage).
- El sonido se genera con WebAudio (sin archivos) y arranca con la primera tecla o toque, por las reglas de autoplay del navegador.
- `session_start` registra `warn` y `sound`.

## Registro de datos (Supabase, opcional)
En el SQL editor de Supabase:

    create table events (
      id bigint generated always as identity primary key,
      created_at timestamptz default now(),
      session_id text, variant text, type text, data jsonb, t integer
    );
    alter table events enable row level security;
    create policy "anon insert" on events for insert to anon with check (true);

Luego pon `SUPABASE_URL` y `SUPABASE_ANON_KEY` al inicio de `game.js`. Eventos: `session_start`, `plug_pull`, `death`, `gem`, `goal`, `rating`.
Sin configurar, los eventos quedan en `localStorage['tidewater_events']`.

## Torres
Las torres miden `WALL_H` (156 px), 36 px mas que el agua alta: el agua nunca las rebasa. Con el agua alta, flotando junto a una torre y empujando hacia ella (o saltando), el personaje da un saltito y trepa a la cima.

## Musica y ajustes (v2)
- Pantalla de titulo: Jugar o cualquier tecla. El juego (Phaser) se crea al empezar.
- Musica procedural suave (WebAudio, sin archivos), volumen bajo por defecto (25%).
- Ajustes (boton de engrane o Esc): musica, efectos y silencio. Pausa el nivel mientras estan abiertos. Se guardan en localStorage.

## v3: enemigos, estilo y progreso
- Enemigos en silueta (constante `ENEMIES` en game.js): cangrejo (suelo, S1 tras el muro), pelicano (superficie, S2 tras el muro) y tiburon (solo con agua alta, sobre el pozo B de S3). Causas de muerte en el registro: `crab`, `pelican`, `shark`.
- Estilo melancolico tipo Limbo: desaturado, tono sepia, vineta y grano (CSS). `?look=color` vuelve a los colores originales (util como condicion de control, porque el filtro baja la saturacion de los peligros rojos).
- Barra de progreso arriba.
- La musica sigue siendo la procedural; si quieres una pista libre (p. ej. CC BY) puedes agregarla con un `<audio loop>` y citar al autor.

## v5: estilo oscuro limpio
- Sin grano, rayos de luz ni polvo. Solo: mas contraste y oscuridad, vineta suave y un pozo de luz alrededor del personaje. Al morir el mundo se vuelve gris un instante.
- `?look=color` quita todo (condicion de control). `session_start` registra `look` (`tragic` o `color`).

## v6: enemigos nuevos
- Pelicano: vuela alto; con agua alta avisa (aleteo y onda en el agua), se lanza en picada, se queda un instante y sube. Con agua baja solo vuela.
- Tiburon: vive en un hueco del suelo de S3 (`SHARK_DEN`). Si estas nadando cerca, sale, te acecha por debajo (aleta en la superficie), salta a morder en el punto donde estabas y vuelve al hueco. Se repite cada 4-6 s mientras sigas nadando cerca. Con el agua baja nunca sale.

## v7
- Corregido: el reinicio (tecla R, boton del final) fallaba desde v4 porque la textura de la luz se creaba otra vez al reiniciar la escena.

## v8
- Vista de hitboxes: tecla H (o ?debug=hitboxes). Verde = cuerpo fisico del jugador, amarillo = caja de dano del jugador, rojo = pinchos, naranja = enemigos, azul = bloques solidos.

## v9: hitboxes alineadas al dibujo
- La caja de dano del jugador sigue al sprite: de pie cubre torso y piernas (~22x69), nadando cubre el cuerpo que asoma sobre el agua (~79 px de ancho). El cuerpo fisico (movimiento y bloques) no cambio.
- Pinchos: la hitbox mide lo mismo que se dibuja (SPIKE_H = 26 px).

## v10
- Al morir se reinician todos los enemigos (cangrejo, pelicano) antes de reaparecer en el checkpoint.
- Tiburon apagado (`SHARK_ON = false` en game.js). El codigo sigue ahi para activarlo mas adelante.

## v8: enemigos y ambiente
- Cangrejo (de frente, dos pinzas con muesca, patas articuladas) y ave carroñera (cuello pelado, pico ganchudo, alas con plumas separadas) redibujados como siluetas con ojos que brillan. Cajas de dano: cangrejo 56x22, ave en picada 26x84 (activa "Mostrar hitboxes" en Ajustes para verlas).
- Decoración estilo Limbo (solo adorno, sin colisión): ramas secas, telarañas, cadenas colgando, arañas en hilo, huesos de pez y niebla baja. Con `?look=color` (condición de control) no se dibuja.
- Techo izquierdo de S3 acortado a 3 casillas (igual que el derecho); el cuerpo físico al nadar cubre todo el dibujo para no traspasar torres.

## v11: drenaje pluvial costero (solo decoracion)
- Escenario: tunel de drenaje que desemboca al mar. Arcos de concreto, manchas de humedad, rejillas oxidadas, numeros de seccion (en ingles) y tuberias viejas en el fondo.
- Quitado: arboles y ramas de pie, telaranas sobre torres y techos solidos, niebla. Reducido: 4 telaranas en esquinas altas, 2 aranas pegadas al techo, 4 cadenas cortas, 5 raices cortas.
- Basura de mar: conchas y redes viejas; los huesos de pez quedan solo junto al pelicano (S2, columnas 14-17).
- Limo, algas y percebes en la base de torres y pozos. Goteras del techo con ondas en el agua. Vapor de humedad muy tenue.
- Luz por seccion: S1 gris oscura, S2 verdosa, S3 azul; la meta tiene luz de afuera. `?look=color` sigue mostrando el fondo original.

## v12
- Salto un poco mas alto: `JUMP_V` de -353 a -385 (altura ~52 px -> ~62 px). El cangrejo conserva su tamano y su caja de dano; el margen para saltarlo sube de ~16 px a ~32 px. Se dejo en 62 px (no mas) para que el salto bajo los pinchos de techo de S3 siga libre con el agua baja.

## v13: cangrejo mas vivo
- Camina de lado a rafagas (arranca y frena con inercia, se detiene a acicalarse, saludar con la pinza o mirar). Ciclo de patas ligado a la distancia (los pies no patinan), cuerpo que se mece, ojos que siguen al jugador.
- Si te acercas (~230 px) levanta las pinzas y chasquea (con sonido). Al llegar al limite de su ruta duda y da la vuelta.
- Agua: al llegarle se sobresalta (salto, pinzas arriba, burbujas y arena). Sumergido esta mas activo, flota con las pinzas en alto, suelta burbujas que revientan en la superficie y de vez en cuando nada un saltito. Al irse el agua se sacude.
- Se dibuja detras del agua, asi que lo que queda bajo la superficie se ve sumergido.
- Jugabilidad: misma caja de dano (56x22) y misma velocidad media; la caja sube con el cuerpo si salta nadando.

## Vercel Speed Insights
- `index.html` incluye el snippet de Speed Insights para sitios estaticos (sin npm). En Vercel: Speed Insights > Enable en el proyecto, `vercel --prod`, visita el sitio y espera ~30 s. En local el script da 404, es normal y no afecta al juego.

## v14: pelicano mas vivo
- Vuela con aleteo en rafagas y planeo con las alas abiertas; el cuerpo sube con cada aleteo y se inclina (sube al despegar, baja al planear). Al dar la vuelta se achica y se voltea suavemente en vez de cambiar de golpe.
- Avisa cerniendose con aleteo rapido, la cabeza baja mirando el agua y un graznido. En picada deja lineas de velocidad; al entrar al agua y al salir hay ondas, y al despegar sacude gotas.
- Sonido: soplido por aleteo y graznido de aviso (suenan segun la cercania).
- Jugabilidad igual: mismos tiempos, misma picada y misma caja de dano (26x84 en picada).
