#!/usr/bin/env bash
set -euo pipefail

owner="$(printf '%s' "${GITHUB_REPOSITORY_OWNER:-dosco}" | tr '[:upper:]' '[:lower:]')"
repository="${GITHUB_REPOSITORY:-dosco/aithy}"
revision="${GITHUB_SHA:-local}"
ref_tag="$(printf '%s' "${AITHY_SANDBOX_REF_TAG:-${GITHUB_REF_NAME:-manual}}" | tr '/:@' '---')"
include_ref_tag="${AITHY_SANDBOX_INCLUDE_REF_TAG:-0}"
promote_existing_latest="${AITHY_SANDBOX_PROMOTE_EXISTING_LATEST:-0}"

verify_public_pull() {
  local name="$1"
  local tag="$2"
  local scope="repository:$owner/$name:pull"
  local token
  token="$(curl -fsSL "https://ghcr.io/token?service=ghcr.io&scope=$scope" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
  test -n "$token"

  local manifest
  manifest="$(curl -fsSL \
    -H "Authorization: Bearer $token" \
    -H "Accept: application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.index.v1+json" \
    "https://ghcr.io/v2/$owner/$name/manifests/$tag")"

  if printf '%s' "$manifest" | grep -q '"manifests"[[:space:]]*:'; then
    echo "::error::$name:$tag resolved to an OCI image index; arch-specific Aithy sandbox tags must be single image manifests."
    exit 1
  fi
}

publish_image() {
  local name="$1"
  local dockerfile="$2"
  local image="ghcr.io/$owner/$name"

  if [[ "$promote_existing_latest" == "1" ]] && promote_latest_arch_tags "$name"; then
    return
  fi

  for arch in amd64 arm64; do
    local arch_ref_tags=()
    if [[ "$include_ref_tag" == "1" ]]; then
      arch_ref_tags=(-t "$image:$ref_tag-$arch")
    fi
    docker buildx build \
      --platform "linux/$arch" \
      --provenance=false \
      --sbom=false \
      --label "org.opencontainers.image.source=https://github.com/$repository" \
      --label "org.opencontainers.image.revision=$revision" \
      -t "$image:latest-$arch" \
      "${arch_ref_tags[@]}" \
      --push \
      -f "$dockerfile" \
      .
    verify_public_pull "$name" "latest-$arch"
  done

  docker buildx imagetools create \
    -t "$image:latest" \
    "$image:latest-amd64" \
    "$image:latest-arm64"

  if [[ "$include_ref_tag" == "1" ]]; then
    docker buildx imagetools create \
      -t "$image:$ref_tag" \
      "$image:$ref_tag-amd64" \
      "$image:$ref_tag-arm64"
  fi
}

promote_latest_arch_tags() {
  local name="$1"
  local image="ghcr.io/$owner/$name"
  local raw
  if ! raw="$(docker buildx imagetools inspect --raw "$image:latest" 2>/dev/null)"; then
    return 1
  fi
  if ! printf '%s' "$raw" | jq -e '.manifests' >/dev/null; then
    return 1
  fi

  for arch in amd64 arm64; do
    local digest
    digest="$(printf '%s' "$raw" | jq -r --arg arch "$arch" '.manifests[] | select(.platform.os == "linux" and .platform.architecture == $arch) | .digest' | head -n 1)"
    test -n "$digest"
    docker buildx imagetools create -t "$image:latest-$arch" "$image@$digest"
    verify_public_pull "$name" "latest-$arch"
  done
}

publish_image "aithy-sandbox" "Dockerfile"
publish_image "aithy-sandbox-lite" "Dockerfile.sandbox-lite"
