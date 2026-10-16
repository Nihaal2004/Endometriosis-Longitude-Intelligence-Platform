"""
MedGemma for MedTrace's interpret-symptom edge function, on a free ZeroGPU Space.

The function calls the `chat` API with an OpenAI-style request (system and user
messages, max_tokens) as a JSON string, and gets back the model's reply text.
Set LLM_API=gradio for the function. The page has a box for trying a description.

- The Space must be PRIVATE: Hugging Face then refuses any request without the
  owner's access token, which the function sends as LLM_API_KEY.
- MedGemma is a gated model: accept its terms on huggingface.co/google/medgemma-4b-it
  and add a read token as the Space secret HF_TOKEN.
- Nothing here logs what patients typed.
"""

import json
import os

import gradio as gr
import spaces
import torch
from transformers import AutoModelForImageTextToText, AutoProcessor

MODEL_ID = "google/medgemma-4b-it"
# The report summary rewrites several sentences at once; symptom and day answers are short.
MAX_NEW_TOKENS = 1024

# ZeroGPU: load onto "cuda" at startup; the real GPU is attached only inside @spaces.GPU.
processor = AutoProcessor.from_pretrained(MODEL_ID, token=os.environ.get("HF_TOKEN"))
model = AutoModelForImageTextToText.from_pretrained(
    MODEL_ID, torch_dtype=torch.bfloat16, token=os.environ.get("HF_TOKEN")
).to("cuda")


def gpu_seconds(messages: list[dict], max_new_tokens: int) -> int:
    # Asking for less GPU time gets a place in the queue sooner.
    return 30 if max_new_tokens <= 300 else 75


@spaces.GPU(duration=gpu_seconds)
def generate(messages: list[dict], max_new_tokens: int) -> str:
    inputs = processor.apply_chat_template(
        messages, add_generation_prompt=True, tokenize=True, return_dict=True, return_tensors="pt"
    ).to(model.device, dtype=torch.bfloat16)
    length = inputs["input_ids"].shape[-1]
    with torch.inference_mode():
        output = model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=False)
    return processor.decode(output[0][length:], skip_special_tokens=True).strip()


def chat(request_json: str) -> str:
    """OpenAI-style request in, reply text out. Only system and user text is used."""
    request = json.loads(request_json)
    messages = [
        {"role": m["role"], "content": [{"type": "text", "text": str(m["content"])}]}
        for m in request.get("messages", [])
        if m.get("role") in ("system", "user", "assistant")
    ]
    max_new_tokens = min(int(request.get("max_tokens") or MAX_NEW_TOKENS), MAX_NEW_TOKENS)
    return generate(messages, max_new_tokens)


def try_it(words: str) -> str:
    return generate(
        [{"role": "user", "content": [{"type": "text", "text": f"Give the clinical term for this symptom, in one to three words: {words}"}]}],
        30,
    )


with gr.Blocks(title="MedTrace MedGemma") as demo:
    gr.Markdown("## MedGemma for MedTrace\nTry a description in the patient's own words:")
    words = gr.Textbox(label="Patient's words", value="it hurts when I poo")
    answer = gr.Textbox(label="MedGemma")
    gr.Button("Ask").click(try_it, words, answer, api_name="try_it")

    # The API the edge function calls: /gradio_api/call/chat
    request_box = gr.Textbox(visible=False)
    reply_box = gr.Textbox(visible=False)
    request_box.submit(chat, request_box, reply_box, api_name="chat")

demo.queue().launch()
