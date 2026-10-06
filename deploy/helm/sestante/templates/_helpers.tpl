{{/* Nome di base delle risorse: <release>-sestante, o il release se lo contiene già. */}}
{{- define "sestante.fullname" -}}
{{- if contains "sestante" .Release.Name -}}
{{- .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-sestante" .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "sestante.labels" -}}
app.kubernetes.io/name: sestante
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "sestante.selector" -}}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/* "/" oppure "/x/": la stessa normalizzazione del server. */}}
{{- define "sestante.base" -}}
{{- $b := trimAll "/" .Values.appBase -}}
{{- if $b -}}/{{ $b }}/{{- else -}}/{{- end -}}
{{- end -}}

{{/* Origine pubblica: https://host[:port] */}}
{{- define "sestante.origin" -}}
{{- if .Values.port -}}
{{- printf "%s://%s:%v" .Values.scheme .Values.host .Values.port -}}
{{- else -}}
{{- printf "%s://%s" .Values.scheme .Values.host -}}
{{- end -}}
{{- end -}}

{{/* URL pubblico dell'app con il percorso, con la barra finale: https://host/sestante/ */}}
{{- define "sestante.url" -}}
{{- printf "%s%s" (include "sestante.origin" .) (include "sestante.base" .) -}}
{{- end -}}

{{- define "sestante.issuer" -}}
{{- if .Values.keycloak.enabled -}}
{{- printf "%sauth/realms/sestante" (include "sestante.url" .) -}}
{{- else -}}
{{- required "keycloak.external.issuer è obbligatorio con keycloak.enabled: false" .Values.keycloak.external.issuer -}}
{{- end -}}
{{- end -}}

{{- define "sestante.secretName" -}}
{{- default (include "sestante.fullname" .) .Values.secrets.existingSecret -}}
{{- end -}}

{{/*
Valore di un segreto: quello dei values, altrimenti quello già nel Secret
(aggiornamenti), altrimenti uno nuovo casuale. Con lettere e cifre garantite,
perché alcune password passano per la regola "lettere e numeri".
*/}}
{{- define "sestante.secretValue" -}}
{{- $existing := lookup "v1" "Secret" .root.Release.Namespace (include "sestante.fullname" .root) -}}
{{- if .value -}}
{{- .value -}}
{{- else if and $existing (index $existing.data .key) -}}
{{- index $existing.data .key | b64dec -}}
{{- else -}}
{{- printf "S%s%d" (randAlphaNum 22) (randInt 10 100) -}}
{{- end -}}
{{- end -}}
