package dto

type PlayGroundRequest struct {
	Model string `json:"model,omitempty" form:"model"`
	Group string `json:"group,omitempty" form:"group"`
	Voice string `json:"voice,omitempty" form:"voice"`
}
