package installscripts

import _ "embed"

//go:embed assets/install.sh
var defaultInstallSh string

//go:embed assets/install.ps1
var defaultInstallPs1 string

