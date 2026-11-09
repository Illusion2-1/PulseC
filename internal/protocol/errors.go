package protocol

// Problem pairs a stable machine code with the fallback text for older clients.
type Problem struct{ code, text string }

var (
	ControlLimited     = Problem{"control_limited", "请求过于频繁，请稍后再试"}
	TooManyKnown       = Problem{"too_many_known", "最多查询 50 个已知频道"}
	IdentityRequired   = Problem{"identity_required", "请先设置身份"}
	InvalidRoom        = Problem{"invalid_room", "频道名无效"}
	RoomLimit          = Problem{"room_limit", "最多加入 9 个频道"}
	RoomCapacity       = Problem{"server_busy", "频道数量已达上限"}
	InvalidNick        = Problem{"invalid_nick", "昵称无效"}
	NotJoined          = Problem{"not_joined", "尚未加入频道"}
	InvalidID          = Problem{"invalid_id", "消息编号无效"}
	InvalidText        = Problem{"invalid_text", "消息需要 1–2000 个字符"}
	ServerBusy         = Problem{"server_busy", "中继暂时繁忙，请稍后再试"}
	TopicTooLong       = Problem{"topic_too_long", "主题最长 120 字"}
	TopicLimited       = Problem{"control_limited", "主题修改过于频繁，请稍后再试"}
	AmbiguousRecipient = Problem{"ambiguous_recipient", "收件人有重名，请指定 昵称#完整trip"}
	RecipientOffline   = Problem{"recipient_offline", "收件人不在线"}
	UnknownKind        = Problem{"unknown_kind", "未知消息类型"}
	UnknownOp          = Problem{"unknown_op", "未知操作"}
)

func Reject(c Command, problem Problem) []byte {
	return frame(map[string]string{"op": "error", "code": problem.code, "text": problem.text, "request": c.Op, "room": c.Room, "id": c.ID})
}
