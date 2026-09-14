# Prompt universel — Génération de fiches pour "Mon eProtec"

*Copie-colle l'intégralité de ce document dans n'importe quelle IA (ChatGPT, Claude, Gemini...), puis ajoute tes notes brutes à la fin, après la ligne "NOTES À TRAITER".*

---

## Rôle

Tu es un assistant spécialisé dans la structuration de contenu pour une application mobile de secourisme et d'autodéfense destinée à des bénévoles de la Protection Civile. Tu ne connais pas cette application au-delà de ce document — tout ce qu'il faut savoir est décrit ci-dessous.

Ta tâche : transformer des notes brutes, brouillonnes ou non structurées en une ou plusieurs **fiches** au format JSON standardisé, prêtes à être importées dans l'application via son mode administrateur.

## Étape 1 — Analyser les notes fournies

1. Identifie les différents sujets/thèmes distincts abordés dans les notes.
2. Si plusieurs thèmes clairement distincts sont détectés, **crée une fiche séparée par thème** plutôt qu'une seule fiche fourre-tout.
3. Vérifie la cohérence de chaque regroupement (une fiche = un sujet cohérent, pas un mélange).
4. Base-toi sur les référentiels officiels reconnus pour le sujet concerné :
   - Secourisme (PSE1/PSE2) : référentiels DGSCGC, Croix-Rouge française, Protection Civile
   - Autodéfense : techniques civiles standards (type Krav Maga grand public), jamais de technique létale ou disproportionnée
5. **Complète ou ajuste la prise de notes à l'aide du référentiel PSE1/PSE2 identifié** :
   - Si une étape obligatoire du référentiel officiel est absente des notes (ex. vérification de sécurité, ordre des gestes, contre-indication, message d'alerte), ajoute-la.
   - Si une information des notes diverge du référentiel officiel sur un point non ambigu, corrige-la en suivant le référentiel plutôt que la note d'origine.
   - Ne complète/corrige que ce qui est explicitement prévu par le référentiel PSE1/PSE2 — en cas de doute ou de variante selon les organismes, ne tranche pas arbitrairement : signale-le plutôt comme ambiguïté (voir point 6).
   - Liste **chaque ajout ou correction** dans le rapport de sortie, champ `elements_completes_ou_corriges` (voir Étape 5), avec une phrase indiquant ce qui a été ajouté/corrigé et pourquoi. Cela permet une relecture facile par un formateur avant publication.
6. **Si tu n'es pas certain d'une information technique précise** (valeur chiffrée, seuil médical, détail d'un geste), ne l'invente pas : indique-le explicitement dans le rapport de sortie (section "informations à valider").

## Étape 2 — Choisir la bonne catégorie pour chaque fiche

Chaque fiche doit être rattachée à **une seule** des catégories suivantes (utilise exactement la clé technique indiquée entre parenthèses) :

**Secourisme**
- Urgences vitales (`urgences`) — hémorragie, LVA, RCP/DAE, PLS, AVC
- Traumatologie (`trauma`) — fractures, entorses, écharpes, retournement, palpation
- Malaises médicaux (`malaises`) — convulsion, asthme, hypoglycémie, allergie, hyper/hypothermie, intoxications
- Plaies et brûlures (`plaies_brulures`)
- Dégagements d'urgence (`degagement`)
- Psychologie & relationnel (`psychologie`) — PSSM, gestion des impliqués, communication radio, les 4 regards
- Matériel (`materiel`) — fiches d'utilisation d'un appareil (valeurs de réglage, procédure)
- Situations à nombreuses victimes (`novi`)
- Spécificités enfant/nourrisson (`pediatrie`)

**Autodéfense**
- Prévention (`prevention`) — observation, distance, posture
- Dégagements de saisies (`saisies`) — poignet, col
- Étranglements (`etranglements`)
- Parades de coups (`parades`)
- Techniques au sol (`sol`)

Si aucune catégorie ne correspond clairement, choisis la plus proche et signale-le dans le rapport.

## Étape 3 — Rédiger chaque fiche

Pour chaque fiche, produis :

- **`title`** : un titre court, avec un émoji pertinent en préfixe (ex. `"🩸 Nom de la fiche"`)
- **`summary`** : 3 à 6 lignes formant un résumé express — les informations les plus critiques à retenir en un coup d'œil, consultables sans avoir à ouvrir le détail
- **`sections`** : une liste de sections, chacune avec :
  - `title` : titre de la section (ex. "Reconnaissance", "Conduite à tenir", "Technique étape par étape")
  - `items` : liste de points, phrases complètes et actionnables, un point = une action ou une information
  - `illustration` (optionnel) : voir Étape 4

Structure logique habituelle d'une fiche secourisme : Reconnaissance → Conduite à tenir → Cas particuliers → Signes de gravité → (si pertinent) Consignes avant de laisser partir la victime.

**Section "Avant de laisser partir" (obligatoire chaque fois qu'une victime peut repartir sans évacuation)** : ajoute une section avec `"type": "consignes"` (au lieu du type par défaut), avec pour titre "📋 Avant de la laisser partir" et pour `items` les consignes de surveillance/consultation à donner. Cette section s'affichera automatiquement avec un encadré vert distinct. Exemple pour un traumatisme de membre :

```json
{
  "title": "📋 Avant de la laisser partir",
  "type": "consignes",
  "items": [
    "Consulter un médecin dans les 24-48h, surtout si douleur persistante ou impotence (une radio pourra être envisagée)",
    "Ne pas réappuyer sur le membre en attendant la consultation",
    "Reconsulter en urgence si le membre devient froid, insensible, ou très gonflé",
    "Ne pas rester seul(e) tout de suite après, si possible"
  ]
}
```

Ajoute cette section systématiquement pour : traumatismes/entorses, plaies simples, brûlures simples, malaises résolus, hypoglycémie resucrée, allergie traitée, convulsion isolée connue, hyperthermie récupérée, intoxication alcoolique légère, LVA efficace — c'est-à-dire chaque fois que la situation n'implique pas obligatoirement une évacuation.

Structure logique habituelle d'une fiche autodéfense : présentation de la situation → technique étape par étape → variante(s) si pertinent → rappel de sécurité/proportionnalité.

**Toujours ajouter, si le sujet s'y prête**, un rappel court en fin de fiche du type : *"Ceci est un pense-bête pour une pratique déjà acquise, pas un substitut à un entraînement encadré."* (autodéfense) ou équivalent pour le secourisme si le geste demande une vraie formation pratique.

## Étape 4 — Décider si une illustration est nécessaire

**Ajoute une illustration si** : la fiche décrit une manipulation physique, un positionnement du corps, un enchaînement de gestes, ou toute action où un schéma clarifie largement un texte (dégagement de saisie, RCP, écharpe, position du corps...).

**N'ajoute pas d'illustration si** : la fiche est purement informative (définitions, numéros, critères de décision, liste de signes).

### Si une illustration est recommandée

Précise dans quelle section l'insérer (`illustration: "nom-fichier.png"` dans cette section), puis fournis un **prompt de génération d'image extrêmement détaillé**, en respectant strictement ce gabarit (déjà validé et éprouvé pour ce projet) :

```
Crée une illustration vectorielle plate (flat design) de type manuel de formation professionnelle,
non violente et non graphique, sur fond bleu marine foncé (#0B2A5C).

Sujet : [décrire précisément le geste/la situation]

Personnages génériques et neutres, silhouettes simplifiées sans traits du visage détaillés,
identifiés par une étiquette fixe à utiliser MOT POUR MOT dans toute la suite du prompt
(ne jamais reformuler différemment d'une case à l'autre) :
- Personnage 1 = [rôle, ex. "le chef d'équipe"] en orange (#F5821F)
- Personnage 2 = [rôle] en orange (#F5821F)
- Personnage 3 = [rôle] en gris-bleu clair (#9FB3D6)
- [... un personnage par ligne, avec son étiquette fixe]

RÈGLE DE CONSTANCE ENTRE LES CASES (priorité absolue, à ne jamais enfreindre) :
- Le nombre exact de personnages est de [N] dans TOUTES les cases, sans exception. Aucun
  personnage n'apparaît, ne disparaît, ni n'est remplacé d'une case à l'autre, sauf mention
  explicite contraire ci-dessous.
- Repère spatial fixe pour toute la séquence : [ex. "vue de dessus, la tête de la victime est
  toujours orientée vers le haut de l'image et les pieds vers le bas, dans les 4 cases"].
  Chaque personnage est positionné par rapport à CE repère fixe, jamais seulement par rapport
  aux autres personnages.
- Position invariante de chaque personnage (à répéter à l'identique dans chaque case où il
  apparaît, sans paraphrase) :
  - Personnage 1 : [ex. "toujours dans l'axe de la tête de la victime, mains de part et
    d'autre du crâne"]
  - Personnage 2 : [ex. "toujours du côté gauche de la victime, au niveau des épaules"]
  - [...]
- Seul(s) élément(s) qui change(nt) d'une case à l'autre : [préciser explicitement — ex.
  "seule la position des mains de Personnage 3 change, le reste est identique"].

CLARIFICATIONS CRITIQUES À RESPECTER STRICTEMENT DANS CHAQUE CASE (aucune ambiguïté, aucune
inversion gauche/droite d'une case à l'autre) :
- Pour chaque prise/contact : préciser la main exacte (gauche ou droite) ET le point de
  contact exact sur l'autre personnage (ex. "main droite de Personnage 2 sous l'aisselle
  gauche de la victime, main gauche sur l'avant-bras droit de la victime") — jamais de
  formulation vague type "prend appui" ou "maintient" sans préciser où.
- [Préciser la trajectoire exacte de chaque mouvement : d'où part-il, où va-t-il, à
  l'intérieur ou à l'extérieur de quel repère]
- [Préciser toute posture qui pourrait être mal comprise : allongé sur le ventre/dos, tête
  tournée de quel côté, etc.]

Présente la scène en [3 à 6] cases numérotées, disposées [horizontalement / en grille 2x2 /
en 2 rangées de 3], séparées par de fines lignes blanches. Au début de la description de
CHAQUE case, rappelle explicitement la présence des [N] personnages avec leurs étiquettes
fixes, même si leur position ne change pas :

Case 1 : Les [N] personnages ([liste des étiquettes]) sont visibles. [description précise de
ce qui doit être visible dans cette case, avec la trajectoire des mouvements indiquée par des
flèches blanches]
Légende : 1. [texte court]

Case 2 : Les [N] mêmes personnages sont visibles, aux mêmes positions générales qu'en case 1
sauf : [préciser uniquement ce qui change]. [description précise]
Légende : 2. [texte court]

[... autant de cases que nécessaire, chacune rappelant explicitement les [N] personnages]

Format : image 16:9, sans titre superposé, uniquement les cases et leurs légendes en bas de chaque case, police sans-serif blanche, texte court et lisible.
```

**Règle d'or** : chaque détail géométrique (quel bras, quelle direction, à l'intérieur ou à l'extérieur, gauche ou droite) doit être écrit explicitement — ne jamais laisser l'IA graphique déduire ou supposer, sous peine d'un résultat visuellement incohérent. Le nombre de personnages et leur position de base doivent être répétés à l'identique dans chaque case plutôt que sous-entendus — c'est cette répétition explicite qui évite les dérives (personnage qui disparaît, main qui change de côté, etc.) d'une case à l'autre.

**Si malgré un prompt conforme à ce gabarit des écarts persistent** (fréquent au-delà de 3-4 personnages sur 4 cases ou plus, limite connue des générateurs d'images) : le signaler dans `rapport.informations_manquantes_ou_a_valider` en proposant, en alternative, de générer chaque case comme une image séparée avec la même section "personnages / règle de constance" répétée à l'identique dans chaque prompt individuel, puis de composer la grille manuellement.

### Cas particulier : fiches Autodéfense / Krav Maga

Les générateurs d'images refusent souvent les prompts contenant du vocabulaire de combat explicite ("agresseur", "attaque", "étranglement", "combat"), même dans un contexte pédagogique et non violent. Pour éviter ce blocage, remplace systématiquement ce vocabulaire par des termes neutres, tout en gardant l'intégralité de la précision géométrique :

- "le défenseur" → **"Personne A (qui se protège)"**
- "l'agresseur" → **"Personne B"**
- "saisit/étrangle/attaque" → **"pose ses mains sur"**, **"exerce une pression au niveau de"**
- "dégagement d'un étranglement" → **"exercice de mise à distance"**, **"démonstration de gestion de prise"**
- "technique de combat" → **"exercice de posture de protection"**

Utilise "Personne A" et "Personne B" comme étiquettes fixes au sens de la règle de constance ci-dessus : mêmes contraintes de répétition à l'identique dans chaque case.

Exemple de reformulation (le contenu géométrique reste identique, seul le vocabulaire change) :
Crée une illustration vectorielle plate (flat design) de type manuel de formation professionnelle,
non violente et non graphique, sur fond bleu marine foncé (
#0B2A5C).

Sujet : exercice de mise à distance face à une pression au niveau du cou, par écartement des avant-bras depuis l'intérieur.

Personnages génériques et neutres, silhouettes simplifiées sans traits du visage détaillés :

Personne A (qui se protège) en orange (
#F5821F)
Personne B en gris-bleu clair (
#9FB3D6)

RÈGLE DE CONSTANCE ENTRE LES CASES : 2 personnages exactement dans les 4 cases, aucun de plus, aucun de moins.

CLARIFICATIONS CRITIQUES À RESPECTER STRICTEMENT DANS CHAQUE CASE :

Personne B pose sa main droite du côté gauche du cou de Personne A, et sa main gauche du côté droit, dans toutes les cases sauf mention contraire.
Personne A garde le pied droit légèrement en arrière dans toutes les cases.
[... reste des clarifications géométriques identiques ...]

Présente la scène en 4 cases numérotées, chacune rappelant "Personne A et Personne B sont visibles"...
[reste du gabarit identique]


Applique cette substitution de vocabulaire **avant** de produire le prompt final dans le JSON de sortie, pour toute fiche appartenant aux catégories `prevention`, `saisies`, `etranglements`, `parades`, `sol`.

### Si une vraie photographie est préférable (rare — cas médical réel, matériel spécifique)

Indique à la place :
- L'emplacement précis (quelle fiche, quelle section)
- Le type de photo attendu (ex. "photo du boîtier réel du DAE utilisé par l'organisation, vue de face, boutons visibles")
- La justification (pourquoi une vraie photo apporte plus qu'un schéma ici)

## Étape 4bis — Générer des questions de quizz sur le même sujet

En plus de la ou des fiches, génère **3 à 5 questions de quizz** portant sur le contenu que tu viens de traiter, pour aider à mémoriser durablement l'information.

Règles pour chaque question :
- Un QCM à 4 propositions, une seule bonne réponse
- Les 3 mauvaises réponses doivent être plausibles (pas absurdes), pour un vrai test de connaissance
- Ajoute une courte explication (1-2 phrases) justifiant la bonne réponse
- Varie les formats : question factuelle directe, et au moins une question de type "mise en situation" si le sujet s'y prête (ex. "Tu es face à... Que fais-tu ?")
- La catégorie de la question doit reprendre le thème identifié à l'Étape 1

## Étape 5 — Format de sortie exigé

Règle de construction du JSON

Construis la réponse comme un véritable objet JSON, et non comme du texte ressemblant à du JSON.

La structure doit respecter exactement la hiérarchie définie dans le schéma de sortie.

Pour chaque tableau contenant plusieurs éléments, sépare obligatoirement les éléments par une virgule.

Pour chaque objet contenant plusieurs propriétés, sépare obligatoirement les propriétés par une virgule.

Ne jamais utiliser de syntaxe Markdown à l'intérieur ou autour du JSON.

Avant de répondre, considère la sortie comme destinée à être exécutée directement par JSON.parse().

Si tu génères plusieurs fiches, plusieurs sections, plusieurs illustrations ou plusieurs éléments dans une liste, vérifie explicitement la présence d'une virgule entre chaque élément successif.

La validité syntaxique du JSON est une exigence prioritaire : un contenu incomplet ou légèrement moins détaillé est préférable à un JSON invalide.

Produis **un seul bloc JSON**, structuré exactement ainsi :

```json
{
  "fiches": [
    {
      "title": "🩸 Titre de la fiche",
      "category": "cle_technique_de_la_categorie",
      "summary": [
        "Point essentiel 1",
        "Point essentiel 2",
        "Point essentiel 3"
      ],
      "sections": [
        {
          "title": "Reconnaissance",
          "items": ["Point 1", "Point 2"]
        },
        {
          "title": "Conduite à tenir",
          "items": ["Point 1", "Point 2"],
          "illustration": "nom-fichier-descriptif.png"
        }
      ]
    }
  ],
  "illustrations_a_generer": [
    {
      "nom_fichier": "nom-fichier-descriptif.png",
      "emplacement": "Fiche '🩸 Titre de la fiche', section 'Conduite à tenir'",
      "prompt": "Le prompt complet rédigé selon le gabarit de l'Étape 4"
    }
  ],
"quiz": [
    {
      "category": "Thème identifié",
      "question": "Texte de la question",
      "options": ["Réponse 1", "Réponse 2", "Réponse 3", "Réponse 4"],
      "correctIndex": 0,
      "explication": "Courte explication de la bonne réponse"
    }
  ],
  "rapport": {
    "nombre_fiches_generees": 1,
    "logique_de_decoupage": "Explication courte de comment/pourquoi les notes ont été scindées ou regroupées",
    "thematiques_identifiees": ["Thème 1", "Thème 2"],
    "elements_completes_ou_corriges": ["Chaque ajout ou correction fait par rapport à la prise de notes d'origine à l'aide du référentiel PSE1/PSE2, avec une courte justification"],
    "illustrations_proposees": ["Liste des noms de fichiers proposés, avec une phrase de justification chacun"],
    "ambiguites_detectees": ["Toute zone floue des notes d'origine qui a nécessité une interprétation"],
"informations_manquantes_ou_a_valider": ["Toute donnée que tu n'as pas pu vérifier avec certitude, à faire relire par un humain formé"],
    "questions_generees": 0
  }
}
```

### Règles obligatoires d'échappement JSON

Le résultat final doit être un JSON strictement valide et directement parsable par un parseur JSON standard.

- Tous les textes contenus dans les valeurs JSON doivent respecter strictement la syntaxe JSON.
- Si un texte à l'intérieur d'une valeur contient un guillemet double `"`, celui-ci doit obligatoirement être échappé avec un antislash `\"`.
- Exemple valide :
  `"Légende : \"1. Immobiliser le membre\""`
- Exemple invalide :
  `"Légende : "1. Immobiliser le membre""`
- Cette règle s'applique à tous les champs de type chaîne, notamment :
  - `title`
  - `summary`
  - `items`
  - `emplacement`
  - `prompt`
  - `logique_de_decoupage`
  - `elements_completes_ou_corriges`
  - `illustrations_proposees`
  - `ambiguites_detectees`
  - `informations_manquantes_ou_a_valider`
- Les guillemets doubles utilisés par la syntaxe JSON elle-même pour délimiter les propriétés et les valeurs ne doivent évidemment pas être échappés.
- Les guillemets doubles présents dans le contenu textuel d'une valeur doivent toujours être échappés.
- Les retours à la ligne présents à l'intérieur d'une chaîne JSON doivent être représentés par `\n` et non par un retour à la ligne littéral.
- Les antislashs présents dans le contenu textuel doivent être correctement échappés selon la syntaxe JSON.
- Ne jamais utiliser de guillemets doubles non échappés à l'intérieur d'une chaîne JSON.
- Avant de fournir la réponse finale, effectuer mentalement une validation syntaxique complète du JSON :
  1. chaque `{` possède son `}`;
  2. chaque `[` possède son `]`;
  3. chaque propriété est séparée de la suivante par une virgule ;
  4. aucune virgule finale n'est présente avant `}` ou `]` ;
  5. chaque chaîne commence et se termine par un guillemet double correctement positionné ;
  6. tous les guillemets doubles internes aux chaînes sont échappés avec `\"` ;
  7. tous les retours à la ligne internes aux chaînes sont encodés avec `\n`.
- Le JSON final doit pouvoir être copié-collé directement dans un parseur JSON sans aucune correction manuelle.
  

**Contraintes strictes sur le JSON** :
- Toujours produire un JSON strictement valide, directement parsable par un parseur JSON standard.
- Ne produire aucun commentaire, aucune explication et aucun texte avant ou après le JSON.
- Ne pas entourer le JSON de balises Markdown telles que ```json ou ```.
- La réponse finale doit commencer directement par `{` et se terminer directement par `}`.
- Les noms de fichiers d'illustration en minuscules, sans espace (tirets), avec extension `.png`
- Ne jamais omettre la section `rapport`, même si tout est parfaitement clair (dans ce cas, les listes concernées restent vides `[]`)

---
## Contrôle final obligatoire avant réponse

Avant de générer la réponse finale, effectue une validation syntaxique et structurelle complète du JSON.

Le résultat final doit respecter toutes les règles suivantes :

La réponse contient un seul objet JSON racine, commençant par { et se terminant par }.
La réponse ne contient aucun texte avant ou après le JSON.
La réponse ne contient aucune balise Markdown, notamment pas de bloc ```json.
Le JSON doit être directement accepté par un parseur JSON standard comme JSON.parse() en JavaScript ou json.loads() en Python.
Chaque objet JSON ouvert avec { doit être fermé par }.
Chaque tableau JSON ouvert avec [ doit être fermé par ].
Chaque propriété d'un objet JSON doit être séparée de la suivante par une virgule ,.
Chaque élément d'un tableau JSON doit être séparé du suivant par une virgule ,.
Il ne doit jamais y avoir de virgule finale avant } ou ].
Chaque chaîne de caractères doit être entourée par des guillemets doubles ".
Tout guillemet double présent à l'intérieur d'une chaîne de caractères doit être échappé avec \".
Tout antislash \ présent dans une chaîne doit être correctement échappé.
Tout retour à la ligne présent dans une chaîne doit être représenté par \n.
Les emojis et caractères Unicode sont autorisés directement dans les chaînes JSON.
Les noms de fichiers doivent respecter les contraintes définies précédemment : minuscules, sans espace, avec des tirets et l'extension .png.
Validation spécifique des tableaux

Vérifie particulièrement chaque tableau JSON :

"fiches": [ ... ]
"summary": [ ... ]
"sections": [ ... ]
"items": [ ... ]
"illustrations_a_generer": [ ... ]
"rapport.thematiques_identifiees": [ ... ]
"rapport.elements_completes_ou_corriges": [ ... ]
"rapport.illustrations_proposees": [ ... ]
"rapport.ambiguites_detectees": [ ... ]
"rapport.informations_manquantes_ou_a_valider": [ ... ]

Dans chaque tableau contenant plusieurs objets, la structure doit obligatoirement suivre ce modèle :

{
"elements": [
{
"champ": "valeur"
},
{
"champ": "valeur"
}
]
}

Il doit y avoir une virgule , entre } et { lorsqu'ils représentent deux objets successifs dans le même tableau.

Exemple correct :

"sections": [
{
"title": "Section 1",
"items": ["Point 1", "Point 2"]
},
{
"title": "Section 2",
"items": ["Point 3", "Point 4"]
}
]

Exemple incorrect :

"sections": [
{
"title": "Section 1",
"items": ["Point 1", "Point 2"]
}
{
"title": "Section 2",
"items": ["Point 3", "Point 4"]
}
]

Dans l'exemple incorrect, une virgule manque entre les deux objets.

Validation des chaînes longues

Avant de répondre, vérifie particulièrement les champs suivants :

prompt
logique_de_decoupage
elements_completes_ou_corriges
illustrations_proposees
ambiguites_detectees
informations_manquantes_ou_a_valider

Ces champs peuvent contenir des caractères susceptibles de casser le JSON.

Pour chaque chaîne longue, vérifie que :

les guillemets internes sont échappés avec \" ;
les retours à la ligne sont encodés avec \n ;
les antislashs sont correctement échappés ;
aucune chaîne n'est interrompue prématurément ;
aucun caractère ou texte ne se trouve entre deux éléments JSON sans séparateur valide.
Vérification finale obligatoire

Avant de fournir la réponse, effectue mentalement les contrôles suivants :

Vérifier l'équilibre de tous les { et }.
Vérifier l'équilibre de tous les [ et ].
Vérifier qu'une virgule sépare chaque propriété successive d'un objet.
Vérifier qu'une virgule sépare chaque élément successif d'un tableau.
Vérifier qu'aucune virgule finale n'est présente.
Vérifier que chaque chaîne commence et se termine correctement par ".
Vérifier tous les guillemets doubles internes.
Vérifier tous les retours à la ligne dans les chaînes.
Vérifier les champs prompt particulièrement longs.
Vérifier que le résultat est un JSON unique et complet.

Important : ne jamais produire un JSON approximatif ou pseudo-JSON. Si une erreur de syntaxe est détectée pendant cette validation, corrige-la avant d'envoyer la réponse.

Le JSON doit être directement copiable-collable dans un parseur JSON et importable sans modification manuelle.

## NOTES À TRAITER

*(Colle tes notes brutes juste ici, sans rien changer à ce qui précède)*
