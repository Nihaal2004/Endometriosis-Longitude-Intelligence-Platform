# MedGemma on a free Hugging Face ZeroGPU Space

This runs MedGemma 4B for MedTrace's `interpret-symptom` function on a free ZeroGPU Space, with no card needed. ZeroGPU lends the Space a GPU only while it's answering, so a suggestion takes about 2–5 seconds. A free account gets **5 GPU-minutes a day**, which is enough for roughly 100 suggestions.

Upload only `app.py` and `requirements.txt`. This file is instructions.

## 1. Accept MedGemma's terms
MedGemma is free, but Google requires you to accept its terms first.
1. Sign in to Hugging Face, then open https://huggingface.co/google/medgemma-4b-it.
2. Click **Agree and access repository**. Access is usually granted at once.

## 2. Create one access token
1. Go to https://huggingface.co/settings/tokens and choose **Create new token → Fine-grained**.
2. Name it `medtrace`.
3. Tick **Read access to contents of all public gated repos you can access**, so the Space can download MedGemma.
4. Under **Repositories permissions**, add your Space `medtrace-medgemma` with **Read access to contents of selected repos**, so Supabase can call the Space. If the Space doesn't exist yet, create the token after step 3 below, or edit it later.
5. Click **Create token** and copy it. It starts with `hf_` and is shown only once.

## 3. Create the Space
1. Go to https://huggingface.co/new-space and set:
   - **Name:** `medtrace-medgemma`
   - **SDK:** **Gradio**, template **Blank**
   - **Hardware:** **ZeroGPU**
   - **Visibility:** **Private**
2. In the Space, go to **Settings → Variables and secrets → New secret**. Set the name to `HF_TOKEN` and the value to your `hf_...` token.
3. Go to **Files → + Contribute → Upload files**, upload `app.py` and `requirements.txt` from this folder, and click **Commit**. Leave the README.md that Hugging Face created as it is.
4. Wait for **Running**. The first start downloads MedGemma (about 8 GB), which takes a few minutes.
5. Open the **App** tab and click **Ask**. "it hurts when I poo" should give something like *Dyschezia*.

If you already created the Space with the earlier files, just upload the new `app.py` and `requirements.txt` over them, and add the `HF_TOKEN` secret.

## 4. Connect Supabase to the Space
The Space's address is on the Space page under **⋮ → Embed this Space → Direct URL**, for example `https://<username>-medtrace-medgemma.hf.space`. Note there's **no `/v1`** on the end this time.

```powershell
npx supabase secrets set LLM_API=gradio LLM_BASE_URL=https://<username>-medtrace-medgemma.hf.space LLM_API_KEY=hf_xxx LLM_TIMEOUT_MS=60000
npx supabase functions deploy interpret-symptom interpret-day summarise-brief
```

## 5. Check it

PowerShell. The second command should print the model's reply:

```powershell
$url = "https://<username>-medtrace-medgemma.hf.space"
$h = @{ Authorization = "Bearer hf_xxx" }
$req = '{"messages":[{"role":"user","content":"Clinical term for: it hurts when I poo. One or two words."}],"max_tokens":20}'
$id = (Invoke-RestMethod "$url/gradio_api/call/chat" -Method Post -Headers $h -ContentType 'application/json' -Body (@{ data = @($req) } | ConvertTo-Json)).event_id
Invoke-RestMethod "$url/gradio_api/call/chat/$id" -Headers $h
```

Without the `-Headers $h` part, the first request should fail with 401 or 404. That proves the Space is private.

Then check it in the app. On the phone, switch on **Me → Your data → AI help** and type `it hurts when I poo` in a check-in. It should suggest **Dyschezia**.

If no suggestion appears, open Supabase Dashboard → **Edge Functions → interpret-symptom → Logs**:

| Log | Meaning |
|---|---|
| `model unreachable` | The Space is asleep, starting, or the URL is wrong |
| `model call failed (401)` or `(404)` | The token is wrong, or doesn't have access to the Space |
| `model call failed (502)` | The Space raised an error. Look at the Space's **Logs** tab; often the daily GPU quota is used up. |
| Nothing logged | The function wasn't called; check that the toggle in Me is on |

## Limits
- **Daily quota:** 5 GPU-minutes a day on a free account, counted from your first use each day. When it runs out, suggestions fail until it resets, and patients' words are saved as typed.
- **Sleep:** the Space sleeps after a while without use. The first suggestion after that fails while it wakes. Opening the Space page wakes it.
- **Account age:** a free account can host ZeroGPU Spaces only once it's over 30 days old and has a verified email.
- **Privacy:** patients' words go to your private Space on Hugging Face's servers, and nowhere else. Nothing in `app.py` logs them.
