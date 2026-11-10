package ali

import (
	"context"
	"fmt"
	"strings"

	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"

	"github.com/samber/lo"
)

func oaiFormEdit2WanxImageEdit(c context.Context, info *common.RelayInfo, request dto.ImageRequest) (*AliImageRequest, error) {
	var err error
	var imageRequest AliImageRequest
	imageRequest.Model = request.Model
	imageRequest.ResponseFormat = request.ResponseFormat
	wanInput := WanImageInput{
		Prompt: request.Prompt,
	}

	// Not supported in library mode
	// if err := json.UnmarshalBodyReusable(c, &wanInput); err != nil {
	// 	return nil, err
	// }
	if wanInput.Images, err = getImageBase64sFromForm(c, "image"); err != nil {
		return nil, fmt.Errorf("get image base64s from form failed: %w", err)
	}
	//wanParams := WanImageParameters{
	//	N: int(request.N),
	//}
	imageRequest.Input = wanInput
	imageRequest.Parameters = AliImageParameters{
		N: int(lo.FromPtrOr(request.N, uint(1))),
	}
	// Not supported in library mode
	// info.PriceData.AddOtherRatio("n", float64(imageRequest.Parameters.N))

	return &imageRequest, nil
}

func isOldWanModel(modelName string) bool {
	return strings.Contains(modelName, "wan") &&
		!lo.SomeBy([]string{"wan2.6", "wan2.7"}, func(v string) bool { return strings.Contains(modelName, v) })
}

func isWanModel(modelName string) bool {
	return strings.Contains(modelName, "wan")
}
