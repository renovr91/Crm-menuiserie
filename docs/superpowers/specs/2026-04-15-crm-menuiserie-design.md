# CRM Menuiserie RENOV-R 91 — Design Spec

## Objectif

CRM complet adapté à l'activité menuiserie (fenêtres, volets roulants, portes de garage). Gestion du processus de vente de bout en bout : du premier contact client jusqu'au SAV, avec suivi des commandes fournisseur, livraisons et poses.

## Utilisateurs

4 commerciaux : Yacine, Karim, Jdis, Samir. Chacun voit ses leads assignés + vue globale pour le manager.

## Architecture

- **Frontend** : Next.js App Router (existant) + Tailwind CSS
- **Backend** : API Routes Next.js + Supabase (PostgreSQL + Auth + Storage)
- **Notifications** : OVH SMS (existant) + push navigateur (Web Push API)
- **Base existante conservée** : devis, signature SMS, paiement Stripe/virement, PDF

---

## 1. Modèle de données

### Tables existantes (conservées telles quelles)

- `clients` — nom, telephone, email, adresse, cp, ville, portal_token, source, notes
- `devis` — reference, status, lignes, montants, pdf_url, signed_pdf_url, payment_status, acompte_pct
- `payments` — montant, methode, status, stripe_session_id, confirmed_at
- `signatures` — signer_name, signer_ip, document_hash, otp_id
- `otp_codes` — phone, code, verified, verified_at

### Modifications table `clients`

Ajouter les colonnes :

| Colonne | Type | Description |
|---------|------|-------------|
| `commercial_id` | uuid FK → commerciaux | Commercial assigné |
| `pipeline_stage` | text | Étape actuelle du pipeline |
| `source` | text | Source du lead (existe déjà, enrichir les valeurs) |
| `besoin` | text | Description courte du besoin client |
| `montant_estime` | numeric | Montant estimé avant devis |
| `priorite` | text | haute / moyenne / basse |
| `perdu_raison` | text | Raison si perdu (trop cher, concurrent, etc.) |

### Nouvelle table `commerciaux`

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid PK | |
| `nom` | text | Nom affiché |
| `telephone` | text | Numéro du commercial |
| `email` | text | Email |
| `couleur` | text | Couleur dans le Kanban (#hex) |
| `actif` | boolean | Actif ou non |
| `created_at` | timestamptz | |

Données initiales : Yacine, Karim, Jdis, Samir.

### Nouvelle table `activites`

Journal d'activité unifié — appels, notes, rappels, relances, RDV.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid PK | |
| `client_id` | uuid FK → clients | |
| `commercial_id` | uuid FK → commerciaux | Qui a fait l'action |
| `type` | text | appel, note, rappel, email, visite, relance |
| `contenu` | text | Description libre |
| `date_prevue` | timestamptz | Date du rappel/RDV (null si note/appel passé) |
| `date_faite` | timestamptz | Date effective (null si pas encore fait) |
| `fait` | boolean | Terminé ou non |
| `created_at` | timestamptz | |

### Nouvelle table `commandes`

Suivi des commandes fournisseur.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid PK | |
| `client_id` | uuid FK → clients | |
| `devis_id` | uuid FK → devis | Devis associé (optionnel) |
| `fournisseur` | text | Flexidoor, David Fermeture, Wibaie, Univers, etc. |
| `reference_commande` | text | Numéro de commande fournisseur |
| `designation` | text | Description des produits commandés |
| `date_commande` | date | Date de passage commande |
| `delai_prevu` | text | Délai annoncé (ex: "6 à 8 semaines") |
| `date_livraison_prevue` | date | Date estimée de livraison |
| `date_livraison_reelle` | date | Date effective |
| `status` | text | en_attente, commandee, en_fabrication, expediee, livree |
| `notes` | text | |
| `created_at` | timestamptz | |

### Nouvelle table `poses`

Planning des poses/installations.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid PK | |
| `client_id` | uuid FK → clients | |
| `commande_id` | uuid FK → commandes | Commande associée (optionnel) |
| `commercial_id` | uuid FK → commerciaux | Poseur/commercial assigné |
| `adresse` | text | Adresse du chantier |
| `date_pose` | date | Date prévue |
| `heure_debut` | time | Heure de début |
| `duree_estimee` | text | Durée estimée (ex: "1 journée") |
| `status` | text | planifiee, en_cours, terminee, reportee |
| `notes` | text | |
| `created_at` | timestamptz | |

### Nouvelle table `sav_tickets`

Tickets SAV.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid PK | |
| `client_id` | uuid FK → clients | |
| `commercial_id` | uuid FK → commerciaux | Assigné à |
| `sujet` | text | Titre du problème |
| `description` | text | Description détaillée |
| `priorite` | text | urgente, haute, moyenne, basse |
| `status` | text | ouvert, en_cours, resolu, ferme |
| `date_resolution` | timestamptz | |
| `notes` | text | Notes de suivi |
| `created_at` | timestamptz | |

---

## 2. Étapes du Pipeline

| Étape | Code | Couleur | Description |
|-------|------|---------|-------------|
| Nouveau | `nouveau` | Bleu | Lead entrant, pas encore contacté |
| Contacté | `contacte` | Jaune | Premier appel fait, besoin qualifié |
| Visite planifiée | `visite` | Indigo | RDV métrage prévu (optionnel) |
| Devis envoyé | `devis_envoye` | Orange | Devis transmis, en attente réponse |
| Signé | `signe` | Vert | Devis accepté et signé |
| Commandé | `commande` | Violet | Commande passée chez fournisseur |
| Livré | `livre` | Violet clair | Produits réceptionnés |
| Posé | `pose` | Teal | Installation terminée (optionnel) |
| Terminé | `termine` | Gris | Chantier clôturé, payé |
| Perdu | `perdu` | Rouge | Client n'a pas donné suite |

Étapes optionnelles : Visite et Posé (sautées en fourniture seule).

---

## 3. Écrans

### 3.1 Navigation principale

Sidebar avec les sections :

- **Pipeline** — Vue Kanban (page d'accueil)
- **Clients** — Liste de tous les clients
- **Livraisons** — Commandes et livraisons en cours
- **Planning** — RDV de pose à venir
- **SAV** — Tickets ouverts
- **Équipe** — Gestion des commerciaux

### 3.2 Pipeline (Kanban)

Page d'accueil du CRM. Colonnes horizontales scrollables.

**Filtres en haut :**
- Par commercial (dropdown : Tous / Yacine / Karim / Jdis / Samir)
- Bouton "+ Nouveau lead" → formulaire rapide
- Bouton "Coller un message" → champ texte + extraction IA

**Chaque carte affiche :**
- Nom du client
- Besoin résumé (1 ligne)
- Montant du devis (si existant)
- Source du lead (badge couleur)
- Commercial assigné
- Alertes (relance à faire, sans réponse depuis X jours, date visite, date livraison)

**Clic sur une carte** → ouvre la fiche client complète.

**Drag & drop** des cartes entre colonnes pour avancer le pipeline (si faisable simplement, sinon bouton "Avancer" sur la fiche).

### 3.3 Fiche client

Page détaillée d'un client. Layout 2 colonnes :

**Colonne principale (2/3) :**
- Infos client (nom, tel, email, adresse) — éditable inline
- Étape pipeline actuelle (dropdown pour changer)
- Onglets :
  - **Activités** — timeline chronologique (appels, notes, relances, visites)
  - **Devis** — liste des devis liés (avec liens vers PDF, statut, paiement)
  - **Commandes** — commandes fournisseur liées
  - **SAV** — tickets SAV liés

**Colonne latérale (1/3) :**
- Commercial assigné (dropdown)
- Source du lead
- Besoin / montant estimé
- Prochaine action (rappel, relance, visite planifiée)
- Boutons d'action rapide :
  - Ajouter une note
  - Planifier un rappel
  - Créer un devis
  - Passer une commande
  - Planifier une pose

### 3.4 Livraisons en cours

Tableau filtrable :

| Client | Fournisseur | Produits | Commandé le | Livraison prévue | Statut |
|--------|-------------|----------|-------------|------------------|--------|

Filtres : par fournisseur, par statut, par commercial.
Tri par date de livraison prévue (les plus proches en premier).

### 3.5 Planning des poses

Vue liste (ou calendrier simple) des poses à venir :

| Date | Heure | Client | Adresse | Produits | Poseur | Statut |
|------|-------|--------|---------|----------|--------|--------|

Filtres : par semaine, par poseur/commercial.

### 3.6 SAV

Tableau des tickets :

| # | Client | Sujet | Priorité | Assigné à | Status | Créé le |
|---|--------|-------|----------|-----------|--------|---------|

Filtres : par statut (ouvert/en cours/résolu), par priorité, par commercial.

### 3.7 Équipe

Liste des commerciaux avec stats :
- Nombre de leads actifs
- CA signé (mois en cours)
- Nombre de devis en attente
- Bouton ajouter/modifier un commercial

---

## 4. Import intelligent (Coller un message)

Modal avec un champ textarea "Collez le message du client ici".

Appel API `/api/leads/import` avec le texte brut. L'API utilise l'IA (Anthropic) pour extraire :
- Nom
- Téléphone
- Email
- Adresse
- Besoin / produits demandés
- Source probable (LeBonCoin si format reconnu, email, etc.)

Retourne les champs pré-remplis dans le formulaire. L'utilisateur valide et ajuste avant de créer le lead.

---

## 5. Relances automatiques

### Règles de relance

| Situation | Délai | Action |
|-----------|-------|--------|
| Devis envoyé sans réponse | 3 jours | Badge "À relancer" sur la carte pipeline |
| Devis envoyé sans réponse | 7 jours | Badge rouge "Urgent" |
| Lead nouveau non contacté | 24h | Badge "À contacter" |

Les alertes apparaissent :
- Sur les cartes du pipeline (badge visuel)
- Dans un compteur dans la sidebar ("3 relances à faire")
- En notification push navigateur (si activé)

### Notifications téléphone

Utiliser les **Web Push Notifications** (Service Worker + Push API) :
- L'utilisateur active les notifs depuis le CRM (bouton "Activer les notifications")
- Le CRM envoie une push quand une relance est due
- Fonctionne sur mobile si le site est ajouté en raccourci (PWA-like)

---

## 6. Intégration avec l'existant

### Devis

Le système de devis actuel est conservé intact :
- Création devis (formulaire + upload PDF)
- Envoi par SMS
- Signature en ligne (OTP + slide)
- PDF signé avec tamponnage
- Paiement Stripe + virement
- Preuve de signature dans le back office

Quand un devis est créé, le client passe automatiquement en étape "Devis envoyé".
Quand un devis est signé, le client passe en "Signé".

### Pipeline ↔ Devis sync

- Créer un devis depuis la fiche client → le devis est automatiquement lié
- Signer un devis → le pipeline_stage du client passe à "signe"
- Payer un devis → enregistré dans l'historique d'activité

---

## 7. Scope de la V1

### Inclus dans la V1

1. Tables BDD (commerciaux, activites, commandes, poses, sav_tickets) + migration clients
2. Pipeline Kanban avec filtres et cartes
3. Fiche client enrichie avec onglets (activités, devis, commandes, SAV)
4. CRUD commandes (suivi livraisons)
5. CRUD poses (planning)
6. CRUD SAV tickets
7. Import intelligent (coller un message → extraction IA)
8. Relances visuelles (badges sur les cartes)
9. Gestion équipe commerciale (4 commerciaux)
10. Navigation sidebar refaite

### Reporté à la V2

- Drag & drop Kanban (V1 : bouton "Avancer l'étape")
- Notifications push téléphone
- Dashboard analytics avancé (CA par commercial, taux conversion, etc.)
- Import CSV en masse
- Calendrier visuel pour les poses
- Relances SMS automatiques
