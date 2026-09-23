# Déployer MailGuard sur AWS EC2 avec k3s

Guide pas à pas. **Tu lances toutes les commandes toi-même** ; rien dans ce dossier ne se connecte à AWS.
Durée : 1 h à 1 h 30 si tout se passe bien.

| Fichier | Rôle |
|---|---|
| `install-k3s.sh` | S'exécute **sur l'EC2** : installe k3s (Traefik, metrics-server et stockage inclus) |
| `render.sh` | S'exécute **sur ton PC** : produit `out/mailguard-aws.yaml` à partir de `k8s/` (non modifié) |
| `out/` | Résultat généré, **ignoré par git** (il contient le mot de passe Grafana) |

Ce qui change par rapport à minikube, et que `render.sh` applique pour toi :
1. les images `mailguard-*:latest` (construites dans minikube) deviennent `ghcr.io/gassops/mailguard-*:<sha>` ;
2. l'Ingress passe de `nginx` à `traefik` (livré avec k3s) et perd l'hôte `mailguard.local` : l'app répond sur l'IP publique ;
3. le Secret est régénéré avec un **nouveau mot de passe Grafana** ; celui de ton PC n'est jamais réutilisé.

---

## 0. Avant de commencer : quelles images déployer ?

- Dépôt : `gassops/mailguard-pfe`, branche `main`. Les 3 packages `ghcr.io/gassops/mailguard-{api,ml,frontend}` sont **publics** : aucun secret de téléchargement nécessaire.
- Les images de chaque commit sont publiées par la CI, tagguées avec le SHA complet du commit. **Utilise le SHA d'un commit dont la CI est verte** (onglet *Actions*).
- Les correctifs de performance et de résilience (Redis sans persistance, sondes tolérantes, keep-alive, disjoncteur SMTP, cache de la blacklist, synchronisation hebdomadaire) sont dans le code **après** le commit `47c720b` : pour les déployer, il faut d'abord commiter et pousser, attendre la CI verte, puis utiliser le nouveau SHA (`git rev-parse HEAD` juste après le push) aux étapes 5 et 6.

## 1. Compte AWS : vérifier et se protéger (10 min)

1. Console → **Billing and Cost Management → Free Tier** : tu dois voir « Free plan » et ton **solde de crédits** (100 $, jusqu'à 200 $ avec les tâches d'onboarding). Le plan s'arrête après 6 mois ou à épuisement des crédits, puis le compte se ferme.
2. **Billing → Budgets → Create budget** : budget mensuel de **1 $**, alerte par email. (Créer un budget fait partie des tâches qui rapportent des crédits en plus.)
3. Choisis une région proche et activée par défaut, par exemple **Europe (Paris) `eu-west-3`**.

## 2. Lancer l'instance EC2 (10 min)

Console → EC2 → **Launch instance** :

| Paramètre | Valeur |
|---|---|
| Nom | `mailguard` |
| AMI | **Ubuntu Server 24.04 LTS**, architecture **x86_64** (tes images sont en amd64) |
| Type | **`t3.medium`** (2 vCPU, 4 Go). Si l'assistant affiche un type sans crédits CPU (par exemple `m7i-flex.large`) comme **éligible au Free plan**, préfère-le. Je n'ai pas pu vérifier cette éligibilité. |
| Paire de clés | Créer `mailguard-key` (RSA, `.pem`), enregistre-la dans `~/mailguard-key.pem` puis `chmod 400 ~/mailguard-key.pem` |
| Groupe de sécurité | **SSH (22) : « My IP » uniquement** · **HTTP (80) : Anywhere**. Rien d'autre (surtout pas 3000, 9090, 3001, 6443). |
| Stockage | **30 Gio gp3** |
| Advanced details → Credit specification | **Standard** (pour les `t3` : la machine ralentit au lieu de te facturer le dépassement) |

Note l'**IP publique** de l'instance. Elle **change si tu arrêtes puis relances** la machine.

## 3. Se connecter

```bash
ssh -i ~/mailguard-key.pem ubuntu@<IP_PUBLIQUE>
```

(Réponds `yes` à la première question, puis `exit`.)

## 4. Installer k3s (5 min)

Depuis ton PC, dans `~/mailguard` :

```bash
scp -i ~/mailguard-key.pem deploy/aws-k3s/install-k3s.sh ubuntu@<IP_PUBLIQUE>:~
ssh -i ~/mailguard-key.pem ubuntu@<IP_PUBLIQUE> 'bash install-k3s.sh'
```

À la fin, tu dois voir un nœud `Ready`, l'IngressClass **`traefik`** et la classe de stockage **`local-path`**.

## 5. Vérifier que les images du commit sont publiées

```bash
TAG=<sha-du-commit-avec-CI-verte>
for p in api ml frontend; do
  TOK=$(curl -s "https://ghcr.io/token?scope=repository:gassops/mailguard-$p:pull" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
  printf "%-10s " $p; curl -s -H "Authorization: Bearer $TOK" https://ghcr.io/v2/gassops/mailguard-$p/tags/list | grep -c "$TAG"
done
```

Chaque ligne doit afficher **1**. Si c'est **0**, la CI n'a pas fini ou a échoué (voir l'onglet *Actions*).

> **Solution de secours sans CI** (si elle échoue) : construire sur ton PC et envoyer les images directement à k3s.
> ```bash
> cd ~/mailguard
> docker build -f api/Dockerfile -t mailguard-api:latest .
> docker build -t mailguard-ml:latest ml-service
> docker build -t mailguard-frontend:latest frontend
> for i in api ml frontend; do
>   docker save mailguard-$i:latest | gzip | \
>     ssh -i ~/mailguard-key.pem ubuntu@<IP_PUBLIQUE> 'gunzip | sudo k3s ctr -n k8s.io images import -'
> done
> ```
> Puis, à l'étape 6, remplace la commande par `IMAGE_SOURCE=local deploy/aws-k3s/render.sh`.

## 6. Générer les manifestes (sur ton PC)

```bash
cd ~/mailguard
IMAGE_TAG=<sha-du-commit-avec-CI-verte> deploy/aws-k3s/render.sh
```

Utilise **explicitement le SHA dont tu as vérifié la CI**, et non un `HEAD` plus récent : si tu commites d'autres fichiers (par exemple `deploy/`), `HEAD` change et ses images n'existent pas encore. La commande affiche le **mot de passe Grafana** (copie dans `deploy/aws-k3s/out/.grafana-password`) : note-le.

## 7. Envoyer et appliquer

```bash
scp -i ~/mailguard-key.pem deploy/aws-k3s/out/mailguard-aws.yaml ubuntu@<IP_PUBLIQUE>:~
ssh -i ~/mailguard-key.pem ubuntu@<IP_PUBLIQUE> 'sudo k3s kubectl apply -f mailguard-aws.yaml'
```

## 8. Suivre le démarrage (3 à 6 min)

```bash
ssh -i ~/mailguard-key.pem ubuntu@<IP_PUBLIQUE> 'sudo k3s kubectl get pods -n mailguard'
```

Tu dois obtenir **10 pods** `Running` : `alertmanager`, `api` ×2, `frontend` ×2, `grafana`, `ml`, `mongo`, `prometheus`, `redis`. Le pod `ml` est le plus lent. Les pods `api` peuvent redémarrer une ou deux fois pendant que MongoDB démarre. Au premier démarrage, l'API importe la blacklist (environ 190 000 domaines) : attends quelques minutes avant les premiers essais.

Mémoire de la machine : `ssh ... 'sudo k3s kubectl top nodes'`.

## 9. Tester

```bash
curl -s http://<IP_PUBLIQUE>/api/v1/health
curl -s -X POST http://<IP_PUBLIQUE>/api/v1/verify/free -H 'Content-Type: application/json' -d '{"email":"test@mailinator.com"}'
```

Puis ouvre **http://<IP_PUBLIQUE>** dans un navigateur : c'est l'interface MailGuard (pas de HTTPS dans cette version).

## 10. Grafana et Prometheus (sans les exposer)

Les deux sont volontairement **absents de l'Ingress**. Passe par un tunnel SSH :

```bash
ssh -i ~/mailguard-key.pem -L 3002:localhost:3002 ubuntu@<IP_PUBLIQUE> \
  'sudo k3s kubectl port-forward -n mailguard svc/grafana 3002:3000'
```

Laisse ce terminal ouvert et ouvre http://localhost:3002 (utilisateur `admin`, mot de passe de l'étape 6). Même principe pour Prometheus avec `svc/prometheus 9090:9090`.

## 11. À ne pas faire

- **Ne lance pas le test de stress k6 sur cette machine** : sur une instance à crédits CPU, il les épuiserait pour rien, et les mesures n'auraient plus de sens. Les mesures du rapport restent celles du cluster local. Un test de fumée léger (quelques requêtes `curl`) suffit ici.
- N'ouvre aucun autre port dans le groupe de sécurité.
- Ne commite pas `deploy/aws-k3s/out/` (déjà ignoré par git).

## 12. Arrêter, détruire, ne pas payer

- **Stop** de l'instance : le calcul n'est plus facturé, mais le disque et l'IP publique continuent de l'être.
- **Terminate** de l'instance, puis suppression du volume s'il reste : plus rien n'est facturé. À faire après la soutenance.
- Surveille **Billing → Free Tier** : le compte se ferme quand les crédits sont épuisés ou à 6 mois.

## 13. Dépannage

| Symptôme | Cause probable | Action |
|---|---|---|
| Pod `ImagePullBackOff` | Tag inexistant (CI pas finie ou en échec) | Refaire l'étape 5 ; sinon utiliser la solution de secours |
| Pod `Pending` | Mémoire insuffisante | `kubectl describe pod` ; envisager le type 8 Go |
| `Connection refused` sur l'IP | Groupe de sécurité (port 80) ou Traefik pas prêt | Vérifier la règle HTTP ; `get pods -n kube-system` |
| `404 page not found` | Ingress non appliqué ou mauvaise classe | `sudo k3s kubectl get ingress -n mailguard` ; attendu : classe `traefik` |
| L'API redémarre en boucle | MongoDB pas encore prêt | Patienter ; `logs deploy/api -n mailguard` |
| L'IP a changé | Instance arrêtée puis relancée | Reprendre la nouvelle IP dans la console |

### Dimensionnement de l'API

Les manifestes de `k8s/` visent un poste à 4 cœurs (4 réplicas minimum, 250m de CPU demandés, 1 CPU max). `render.sh` règle par défaut une petite instance (2 vCPU) sur **2 à 6 réplicas, 100m demandés, 500m max**. Pour une machine plus grande, par exemple 4 vCPU :

```bash
API_MIN_REPLICAS=4 API_CPU_REQUEST=250m API_CPU_LIMIT=1000m IMAGE_TAG=<sha> deploy/aws-k3s/render.sh
```

## Points d'attention

- **Pas de TLS** : l'Ingress répond en HTTP. Acceptable pour une démonstration ; pour du réel, ajouter un nom de domaine et cert-manager.
- **Quota anonyme par IP** (`/verify/free`, 3 par jour) : derrière Traefik, l'adresse vue par l'API peut être celle du proxy, donc partagée entre visiteurs. Sans conséquence pour une démonstration.
- **Sauvegarde** : le volume MongoDB est sur le disque de l'instance (`local-path`). Détruire l'instance détruit les données.
