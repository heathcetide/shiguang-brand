package system

import (
	"runtime"

	"github.com/heathcetide/DietDigiDose/pkg/common"
	"github.com/grafana/pyroscope-go"
)

// StartPyroScope starts a Pyroscope profiling session using environment
// variables for configuration:
//   - PYROSCOPE_URL            (required; empty skips startup)
//   - PYROSCOPE_APP_NAME       (default "ling-base")
//   - PYROSCOPE_BASIC_AUTH_USER
//   - PYROSCOPE_BASIC_AUTH_PASSWORD
//   - HOSTNAME                 (default "ling-base")
//   - PYROSCOPE_MUTEX_RATE     (default 5)
//   - PYROSCOPE_BLOCK_RATE     (default 5)
func StartPyroScope() error {
	pyroscopeUrl := common.GetEnv("PYROSCOPE_URL")
	if pyroscopeUrl == "" {
		return nil
	}

	pyroscopeAppName := common.GetEnv("PYROSCOPE_APP_NAME")
	if pyroscopeAppName == "" {
		pyroscopeAppName = "ling-base"
	}
	pyroscopeBasicAuthUser := common.GetEnv("PYROSCOPE_BASIC_AUTH_USER")
	pyroscopeBasicAuthPassword := common.GetEnv("PYROSCOPE_BASIC_AUTH_PASSWORD")
	pyroscopeHostname := common.GetEnv("HOSTNAME")
	if pyroscopeHostname == "" {
		pyroscopeHostname = "ling-base"
	}

	mutexRate := common.GetIntEnv("PYROSCOPE_MUTEX_RATE")
	if mutexRate == 0 {
		mutexRate = 5
	}
	blockRate := common.GetIntEnv("PYROSCOPE_BLOCK_RATE")
	if blockRate == 0 {
		blockRate = 5
	}

	runtime.SetMutexProfileFraction(int(mutexRate))
	runtime.SetBlockProfileRate(int(blockRate))

	_, err := pyroscope.Start(pyroscope.Config{
		ApplicationName: pyroscopeAppName,

		ServerAddress:     pyroscopeUrl,
		BasicAuthUser:     pyroscopeBasicAuthUser,
		BasicAuthPassword: pyroscopeBasicAuthPassword,

		Logger: nil,

		Tags: map[string]string{"hostname": pyroscopeHostname},

		ProfileTypes: []pyroscope.ProfileType{
			pyroscope.ProfileCPU,
			pyroscope.ProfileAllocObjects,
			pyroscope.ProfileAllocSpace,
			pyroscope.ProfileInuseObjects,
			pyroscope.ProfileInuseSpace,

			pyroscope.ProfileGoroutines,
			pyroscope.ProfileMutexCount,
			pyroscope.ProfileMutexDuration,
			pyroscope.ProfileBlockCount,
			pyroscope.ProfileBlockDuration,
		},
	})
	if err != nil {
		return err
	}
	return nil
}
