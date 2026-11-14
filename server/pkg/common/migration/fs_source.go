// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package migration

import (
	"io/fs"
	"os"
)

// openOSFile opens a file from the OS filesystem for use with fs.FS interface.
// This is used by FileSource to read migration files from a directory.
func openOSFile(name string) (fs.File, error) {
	return os.Open(name)
}

// fileSystemFS wraps an os filesystem directory as an fs.FS.
type fileSystemFS struct {
	dir string
}

func (f fileSystemFS) Open(name string) (fs.File, error) {
	return os.Open(f.dir + "/" + name)
}

// newFileFS creates an fs.FS rooted at the given directory.
func newFileFS(dir string) fs.FS {
	return fileSystemFS{dir: dir}
}
