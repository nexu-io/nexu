{{- define "nexu.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "nexu.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "nexu.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "nexu.labels" -}}
helm.sh/chart: {{ include "nexu.chart" . }}
app.kubernetes.io/name: {{ include "nexu.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: nexu
{{- with .Values.global.labels }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{- define "nexu.selectorLabels" -}}
app.kubernetes.io/name: {{ include "nexu.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "nexu.namespace" -}}
{{- default .Release.Namespace .Values.namespace.name -}}
{{- end -}}

{{- define "nexu.api.fullname" -}}
{{- printf "%s-api" (include "nexu.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "nexu.web.fullname" -}}
{{- printf "%s-web" (include "nexu.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "nexu.gateway.fullname" -}}
{{- printf "%s-gateway" (include "nexu.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "nexu.configMapName" -}}
{{- printf "%s-config" (include "nexu.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "nexu.secretName" -}}
{{- printf "%s-secrets" (include "nexu.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
