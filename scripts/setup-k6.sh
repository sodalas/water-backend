#!/bin/bash
# k6 Installation Script
# k6 is a standalone binary for load testing, not an npm package.
#
# Installation instructions:
#
# Windows (using Chocolatey):
#   choco install k6
#
# Windows (using winget):
#   winget install k6 --source winget
#
# macOS (using Homebrew):
#   brew install k6
#
# Linux (Debian/Ubuntu):
#   sudo gpg -k
#   sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
#   echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
#   sudo apt-get update
#   sudo apt-get install k6
#
# Or download from: https://k6.io/docs/get-started/installation/
#
# Verify installation:
#   k6 version
