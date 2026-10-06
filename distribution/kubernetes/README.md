# Sestante su Kubernetes (Helm)

Chart in `distribution/kubernetes/sestante`: Sestante con PostgreSQL, Keycloak (realm già
configurato), il relay di collaborazione e gli Ingress per nginx.

```bash
helm install sestante distribution/kubernetes/sestante \
  --namespace sestante --create-namespace \
  --set host=mappe.example.org \
  --set image.repository=registry.example.org/sestante --set image.tag=0.1.0 \
  --set ingress.tls.secretName=mappe-tls
```

Le note stampate a fine installazione dicono l'indirizzo e come leggere le
password generate.

## L'immagine

Il chart usa l'immagine di `distribution/docker/Dockerfile`, da
pubblicare in un registro raggiungibile dal cluster:

```bash
docker build -t registry.example.org/sestante:0.1.0 --build-arg APP_BASE=/ -f distribution/docker/Dockerfile .
docker push registry.example.org/sestante:0.1.0
```

`APP_BASE` deve coincidere con `appBase` del chart: GeoLibre fissa il percorso
nel proprio build. Se non coincide, Sestante lo scrive nel log e ripiega
sull'istanza pubblica di GeoLibre.

## Cosa installa

| Componente | Risorse | Note |
| --- | --- | --- |
| Sestante | Deployment, Service, PVC (file caricati) | modalità `server`, PostgreSQL; più repliche solo con un volume ReadWriteMany |
| Relay | Deployment (1 replica), Service, PVC | le sessioni vive stanno nella memoria del relay |
| Keycloak | Deployment, Service, ConfigMap del realm | realm `sestante` importato all'avvio; `keycloak.enabled: false` per un OIDC esterno |
| PostgreSQL | StatefulSet, Service, ConfigMap di inizializzazione | database e utente per Sestante e per Keycloak; `postgresql.enabled: false` per uno esterno |
| Ingress | app e Keycloak; relay (con riscrittura del prefisso e tempi lunghi per i WebSocket); rimando dalla radice se `appBase` non è `/` | classe `nginx` |
| Secret | segreti dell'installazione | generati al primo `install` e **conservati negli aggiornamenti** |

Il realm e lo script di PostgreSQL sono gli stessi file usati dal compose
(`files/`), così le due distribuzioni non divergono.

## Valori principali

| Valore | Default | Cosa decide |
| --- | --- | --- |
| `host`, `scheme`, `port` | `sestante.example.org`, `https`, — | indirizzo pubblico (`port` solo se non standard) |
| `appBase` | `/` | percorso sotto cui sta tutto: app, `<appBase>auth`, `<appBase>collab` |
| `image.repository`, `image.tag` | `sestante`, `latest` | immagine di Sestante (anche per il relay) |
| `defaultUser.email`, `.password` | `admin@example.org`, generata | utente di default, creato al primo avvio |
| `keycloak.demoUser.enabled`, `.password` | `true`, generata | utente di prova `anna.verdi` nel realm |
| `secrets.*` / `secrets.existingSecret` | generati | segreti forniti a mano, o un Secret già esistente con le stesse chiavi |
| `sestante.allowLocalSignup` | `false` | registrazione con email aperta a tutti |
| `ingress.tls.secretName` / `ingress.tls.selfSigned` | — / `false` | certificato (es. da cert-manager) o autofirmato generato dal chart |
| `postgresql.external.*`, `keycloak.external.*` | — | servizi esterni al posto di quelli del chart |

Le password generate si leggono dal Secret, ad esempio:

```bash
kubectl get secret sestante -n sestante -o jsonpath='{.data.default-user-password}' | base64 -d
```

## Provarlo in locale con kind

```bash
kind create cluster --name sestante --config distribution/kubernetes/kind-cluster.yaml
kubectl apply -f https://kind.sigs.k8s.io/examples/ingress/deploy-ingress-nginx.yaml
kubectl wait -n ingress-nginx --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller --timeout=240s

docker build -t sestante:latest --build-arg APP_BASE=/sestante/ -f distribution/docker/Dockerfile .
kind load docker-image sestante:latest --name sestante

helm install sestante distribution/kubernetes/sestante -n sestante --create-namespace \
  --set host=localhost --set port=9443 --set appBase=/sestante/ \
  --set ingress.tls.selfSigned=true --set image.pullPolicy=Never
```

Poi <https://localhost:9443/sestante/> (certificato autofirmato). Su Git Bash
per Windows anteporre `MSYS_NO_PATHCONV=1`: altrimenti `/sestante/` viene
convertito in un percorso Windows.

Verifica end-to-end, dalla radice del progetto:

```bash
E2E_STACK_URL=https://localhost:9443/sestante/ \
E2E_DEFAULT_PASSWORD=$(kubectl get secret sestante -n sestante -o jsonpath='{.data.default-user-password}' | base64 -d) \
E2E_SSO_PASSWORD=$(kubectl get secret sestante -n sestante -o jsonpath='{.data.demo-user-password}' | base64 -d) \
E2E_K8S_NAMESPACE=sestante \
npm run test:e2e:stack
```

Per togliere tutto: `kind delete cluster --name sestante`.
