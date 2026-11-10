package kitutil

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

func GetPointer[T any](v T) *T {
	return &v
}

func Interface2String(inter interface{}) string {
	switch v := inter.(type) {
	case string:
		return v
	case int:
		return fmt.Sprintf("%d", v)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		if v {
			return "true"
		}
		return "false"
	case nil:
		return ""
	default:
		return fmt.Sprintf("%v", inter)
	}
}

func String2Int(str string) int {
	num, err := strconv.Atoi(str)
	if err != nil {
		return 0
	}
	return num
}

func GetUUID() string {
	code := uuid.New().String()
	code = strings.Replace(code, "-", "", -1)
	return code
}

func GetTimestamp() int64 {
	return time.Now().Unix()
}
