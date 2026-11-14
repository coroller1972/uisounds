# UISounds

Petits sons d'interface synthétisés avec la Web Audio API : aucun fichier `.wav`, juste du script (environ 6 ko compressé).

**[Écouter les sons →](https://coroller1972.github.io/uisounds/)**

| Son | Caractère |
|---|---|
| `tap` | petit choc boisé et mat |
| `click` | clic mécanique net |
| `tick` | tic minuscule, cran de molette |
| `toc` | coup sec sur du bois |
| `pat` | tape feutrée et mate |
| `pop` | bulle qui éclate |
| `bloop` | goutte d'eau |
| `blip` | bip rétro |
| `ding` | clochette de notification |
| `woof` | aboiement |
| `shh` | chut |
| `whoosh` | souffle de glissement |
| `success` | trois notes montantes |
| `error` | deux notes basses, refus |

## Installation

Avec une balise script (expose `window.UISounds`) :

```html
<script src="uisounds.js"></script>
```

Ou depuis le paquet `.tgz` attaché à chaque [release](https://github.com/coroller1972/uisounds/releases) :

```bash
npm install ./uisounds-0.1.0.tgz
```

```js
const UISounds = require('uisounds');
```

## Utilisation

```js
UISounds.play('tap');                    // ou UISounds.tap()
UISounds.play('woof', { pitch: 0.7 });   // plus grave
UISounds.play('tick', { vary: 0.08 });   // légère variation aléatoire
```

Options de `play(nom, options)` :

| Option | Valeurs | Défaut | Effet |
|---|---|---|---|
| `volume` | 0 à 1 | 1 | volume de ce son |
| `pitch` | > 0 | 1 | multiplicateur de hauteur (2 = une octave au-dessus) |
| `vary` | 0 à 1 | 0 | variation aléatoire de hauteur, ± `vary` |
| `pan` | -1 à 1 | 0 | position stéréo |
| `delay` | secondes | 0 | délai avant le déclenchement |

`play()` renvoie la durée du son en secondes.

Le reste de l'API :

- `UISounds.names` : la liste des sons disponibles.
- `UISounds.volume` : volume général, de 0 à 1.
- `UISounds.muted` : coupe ou rétablit le son.
- `UISounds.unlock()` : réveille l'audio ; à appeler dans un geste de l'utilisateur si le navigateur l'exige.
- `UISounds.bind(racine?)` : joue automatiquement tout élément portant `data-sound="tap"`.
- `UISounds.render(nom, options)` : rendu hors ligne, renvoie une `Promise<AudioBuffer>` (pour afficher une forme d'onde, par exemple).
- `UISounds.define(nom, recette)` : ajoute un son personnalisé.

## Créer un son

Une recette reçoit une « trousse » à trois briques :

- `tone(o)` : un oscillateur ;
- `hiss(o)` : du bruit blanc ;
- `strike(o)` : un choc, c'est-à-dire un bruit très bref qui excite des résonances.

```js
UISounds.define('plink', (k) => {
  k.tone({ freq: [[0, 1800], [0.05, 1200]], decay: 0.15, gain: 0.5 });
  k.hiss({ filter: { type: 'highpass', freq: 4000 }, decay: 0.01, gain: 0.2 });
});
UISounds.plink();
```

Les options de `tone` et `hiss` sont détaillées en tête de [`uisounds.js`](uisounds.js).

## Développement

```bash
npm test     # vérification minimale sous Node
npm pack     # produit uisounds-<version>.tgz
```

La page de test ([`index.html`](index.html)) s'ouvre directement dans un navigateur, sans serveur.

Pour publier une version : mettre à jour `version` dans `package.json`, puis pousser une étiquette `v<version>` (par exemple `v0.2.0`). La CI vérifie la correspondance et attache le `.tgz` à une release GitHub.
