// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package archive provides utilities for creating and extracting compressed
// archives (zip, tar, tar.gz) as well as single-file gzip compression. It uses
// only the Go standard library (archive/zip, archive/tar, compress/gzip).
//
// All extraction helpers perform path-traversal (zip-slip / tar-slip) checks
// so that entries containing ".." or absolute paths cannot escape the
// destination directory.
//
// # Quick start
//
//	// Zip a directory
//	archive.Zip("mydir", "mydir.zip")
//	// Unzip it back
//	archive.Unzip("mydir.zip", "out")
//	// Detect format
//	fmt.Println(archive.DetectFormat("mydir.zip")) // "zip"
//	// List contents
//	archive.ListArchive("mydir.zip")
package archive

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/common/compress"
)

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

var (
	// ErrUnsupportedFormat is returned when an archive format cannot be
	// detected or is not supported.
	ErrUnsupportedFormat = errors.New("archive: unsupported format")

	// ErrPathEscapes is returned when an archive entry would extract outside
	// the destination directory (path-traversal attack).
	ErrPathEscapes = errors.New("archive: path escapes destination directory")
)

// Format constants returned by DetectFormat.
const (
	FormatZip   = "zip"
	FormatTar   = "tar"
	FormatTarGz = "tar.gz"
	FormatGz    = "gz"
)

// ──────────────────────────────────────────────
// Archiver interface
// ──────────────────────────────────────────────

// Archiver is the interface implemented by each archive format. Archive packs
// the src directory into w; Unarchive extracts the contents of r into dst.
type Archiver interface {
	Archive(src string, w io.Writer) error
	Unarchive(r io.Reader, dst string) error
}

// ──────────────────────────────────────────────
// Path safety
// ──────────────────────────────────────────────

// safeJoin joins dst with name and verifies the result stays within dst. It
// returns ErrPathEscapes if the joined path would leave the destination
// directory.
func safeJoin(dst, name string) (string, error) {
	cleaned := filepath.Clean(name)
	// Reject absolute paths.
	if filepath.IsAbs(cleaned) {
		return "", ErrPathEscapes
	}
	// Reject paths that start with "..".
	if strings.HasPrefix(cleaned, "..") {
		return "", ErrPathEscapes
	}
	joined := filepath.Join(dst, cleaned)
	absDst, err := filepath.Abs(dst)
	if err != nil {
		return "", err
	}
	absJoined, err := filepath.Abs(joined)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(absDst, absJoined)
	if err != nil {
		return "", err
	}
	if strings.HasPrefix(rel, "..") {
		return "", ErrPathEscapes
	}
	return joined, nil
}

// ──────────────────────────────────────────────
// ZipArchiver
// ──────────────────────────────────────────────

// ZipArchiver creates and extracts ZIP archives.
type ZipArchiver struct{}

// Archive walks src and writes a ZIP archive containing every file and
// directory (preserving relative paths) to w.
func (*ZipArchiver) Archive(src string, w io.Writer) error {
	zw := zip.NewWriter(w)

	walkErr := filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		// ZIP uses forward slashes.
		rel = filepath.ToSlash(rel)

		hdr, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		hdr.Name = rel
		if info.IsDir() {
			hdr.Name += "/"
			hdr.Method = zip.Store
		} else {
			hdr.Method = zip.Deflate
		}

		writer, err := zw.CreateHeader(hdr)
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()
		_, err = io.Copy(writer, file)
		return err
	})
	if walkErr != nil {
		_ = zw.Close()
		return walkErr
	}
	return zw.Close()
}

// Unarchive extracts a ZIP archive read from r into dst, creating directories
// as needed. Every entry is checked for path traversal.
func (*ZipArchiver) Unarchive(r io.Reader, dst string) error {
	// zip.NewReader requires a ReaderAt + size. Copy to a temp file.
	tmp, err := os.CreateTemp("", "archive-unzip-*.zip")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()

	if _, err := io.Copy(tmp, r); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}

	zr, err := zip.OpenReader(tmp.Name())
	if err != nil {
		return err
	}
	defer zr.Close()

	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}

	for _, f := range zr.File {
		target, err := safeJoin(dst, f.Name)
		if err != nil {
			return err
		}
		if strings.HasSuffix(f.Name, "/") {
			mode := f.Mode().Perm()
			if mode == 0 {
				mode = 0o755
			}
			// Directories need execute bits to be traversable.
			mode |= 0o111
			if err := os.MkdirAll(target, mode); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		mode := f.Mode().Perm()
		if mode == 0 {
			mode = 0o644
		}
		out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
		if err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			out.Close()
			return err
		}
		if _, err := io.Copy(out, rc); err != nil {
			rc.Close()
			out.Close()
			return err
		}
		rc.Close()
		out.Close()
	}
	return nil
}

// ──────────────────────────────────────────────
// TarArchiver
// ──────────────────────────────────────────────

// TarArchiver creates and extracts uncompressed TAR archives.
type TarArchiver struct{}

// Archive walks src and writes a TAR archive to w.
func (*TarArchiver) Archive(src string, w io.Writer) error {
	tw := tar.NewWriter(w)

	walkErr := filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		rel = filepath.ToSlash(rel)

		hdr, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		hdr.Name = rel

		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()
		_, err = io.Copy(tw, file)
		return err
	})
	if walkErr != nil {
		_ = tw.Close()
		return walkErr
	}
	return tw.Close()
}

// Unarchive extracts a TAR archive read from r into dst.
func (*TarArchiver) Unarchive(r io.Reader, dst string) error {
	return untar(r, dst)
}

// untar is shared by TarArchiver and TarGzArchiver.
func untar(r io.Reader, dst string) error {
	tr := tar.NewReader(r)
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		target, err := safeJoin(dst, hdr.Name)
		if err != nil {
			return err
		}
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, os.FileMode(hdr.Mode)); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, os.FileMode(hdr.Mode))
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, tr); err != nil {
				out.Close()
				return err
			}
			out.Close()
		case tar.TypeSymlink:
			// Skip symlinks for safety (could escape destination).
			continue
		default:
			// Skip unknown types (hardlinks, fifos, etc.).
			continue
		}
	}
	return nil
}

// ──────────────────────────────────────────────
// TarGzArchiver
// ──────────────────────────────────────────────

// TarGzArchiver creates and extracts gzip-compressed TAR archives.
type TarGzArchiver struct{}

// Archive walks src and writes a gzip-compressed TAR archive to w.
func (*TarGzArchiver) Archive(src string, w io.Writer) error {
	gw := gzip.NewWriter(w)
	if err := (&TarArchiver{}).Archive(src, gw); err != nil {
		_ = gw.Close()
		return err
	}
	return gw.Close()
}

// Unarchive extracts a gzip-compressed TAR archive read from r into dst.
func (*TarGzArchiver) Unarchive(r io.Reader, dst string) error {
	gr, err := gzip.NewReader(r)
	if err != nil {
		return err
	}
	defer gr.Close()
	return untar(gr, dst)
}

// ──────────────────────────────────────────────
// Convenience functions
// ──────────────────────────────────────────────

// Zip creates a ZIP archive of the src directory at dst.
func Zip(src, dst string) error {
	f, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer f.Close()
	return (&ZipArchiver{}).Archive(src, f)
}

// Unzip extracts the ZIP archive at src into dst.
func Unzip(src, dst string) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	return (&ZipArchiver{}).Unarchive(f, dst)
}

// Tar creates a TAR archive of the src directory at dst.
func Tar(src, dst string) error {
	f, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer f.Close()
	return (&TarArchiver{}).Archive(src, f)
}

// Untar extracts the TAR archive at src into dst.
func Untar(src, dst string) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	return (&TarArchiver{}).Unarchive(f, dst)
}

// TarGz creates a gzip-compressed TAR archive of the src directory at dst.
func TarGz(src, dst string) error {
	f, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer f.Close()
	return (&TarGzArchiver{}).Archive(src, f)
}

// UntarGz extracts the gzip-compressed TAR archive at src into dst.
func UntarGz(src, dst string) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	return (&TarGzArchiver{}).Unarchive(f, dst)
}

// CompressFile gzip-compresses a single file from src to dst.
//
// Delegates the core gzip compression to compress.GzipCompress, reading
// the source file into memory, compressing, and writing the result to dst.
func CompressFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}

	compressed, err := compress.GzipCompress(data, compress.LevelDefault)
	if err != nil {
		return err
	}

	return os.WriteFile(dst, compressed, 0o644)
}

// DecompressFile decompresses a single gzip file from src to dst.
//
// Delegates the core gzip decompression to compress.GzipDecompress, reading
// the gzip file into memory, decompressing, and writing the result to dst.
func DecompressFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}

	decompressed, err := compress.GzipDecompress(data)
	if err != nil {
		return err
	}

	return os.WriteFile(dst, decompressed, 0o644)
}

// ──────────────────────────────────────────────
// Format detection & listing
// ──────────────────────────────────────────────

// DetectFormat inspects the first few bytes of the file at path and returns
// one of FormatZip, FormatTarGz, FormatGz, or FormatTar. It returns
// ErrUnsupportedFormat for unknown formats.
func DetectFormat(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	buf := make([]byte, 512)
	n, err := f.Read(buf)
	if err != nil && err != io.EOF {
		return "", err
	}
	buf = buf[:n]

	// ZIP: PK\x03\x04
	if len(buf) >= 4 && buf[0] == 'P' && buf[1] == 'K' && buf[2] == 3 && buf[3] == 4 {
		return FormatZip, nil
	}
	// GZIP: \x1f\x8b
	if len(buf) >= 2 && buf[0] == 0x1f && buf[1] == 0x8b {
		// Could be tar.gz or plain gz. Decompress and check for the tar magic
		// ("ustar" at offset 257). Rewind the file first since we already read
		// 512 bytes for magic detection.
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			return FormatGz, nil
		}
		gr, err := gzip.NewReader(f)
		if err != nil {
			return FormatGz, nil
		}
		peek := make([]byte, 512)
		// tar magic "ustar" appears at offset 257.
		gn, _ := gr.Read(peek)
		gr.Close()
		if gn >= 262 && string(peek[257:262]) == "ustar" {
			return FormatTarGz, nil
		}
		return FormatGz, nil
	}
	// TAR: "ustar" magic at offset 257.
	if len(buf) >= 262 && string(buf[257:262]) == "ustar" {
		return FormatTar, nil
	}
	return "", ErrUnsupportedFormat
}

// ListArchive returns the list of entry names contained in the archive at
// path. The format is auto-detected via DetectFormat.
func ListArchive(path string) ([]string, error) {
	format, err := DetectFormat(path)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	switch format {
	case FormatZip:
		return listZip(path)
	case FormatTar:
		return listTar(f)
	case FormatTarGz:
		gr, err := gzip.NewReader(f)
		if err != nil {
			return nil, err
		}
		defer gr.Close()
		return listTar(gr)
	case FormatGz:
		// Single-file gzip: the "entry" is the gzip header name.
		gr, err := gzip.NewReader(f)
		if err != nil {
			return nil, err
		}
		defer gr.Close()
		name := gr.Name
		if name == "" {
			name = filepath.Base(path)
			if strings.HasSuffix(name, ".gz") {
				name = strings.TrimSuffix(name, ".gz")
			}
		}
		return []string{name}, nil
	default:
		return nil, ErrUnsupportedFormat
	}
}

// listZip opens a zip file by path and lists entry names.
func listZip(path string) ([]string, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	names := make([]string, 0, len(zr.File))
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	return names, nil
}

// listTar lists entry names from a tar reader.
func listTar(r io.Reader) ([]string, error) {
	tr := tar.NewReader(r)
	names := []string{}
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		names = append(names, hdr.Name)
	}
	return names, nil
}

// fmt import guard (used in error wrapping elsewhere if needed).
var _ = fmt.Sprintf
