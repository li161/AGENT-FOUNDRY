import argparse, json
from pathlib import Path
from datasets import Dataset
from transformers import AutoTokenizer, AutoModelForCausalLM, Trainer, TrainingArguments, DataCollatorForLanguageModeling

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--input',required=True);p.add_argument('--output',required=True)
    p.add_argument('--model',default='Qwen/Qwen2.5-0.5B-Instruct')
    p.add_argument('--epochs',type=float,default=2);p.add_argument('--max-length',type=int,default=1024)
    a=p.parse_args()
    rows=[]
    for n,line in enumerate(Path(a.input).read_text(encoding='utf-8').splitlines(),1):
        if not line.strip():continue
        item=json.loads(line);text=str(item.get('text','')).strip()
        if text:rows.append({'text':text})
    if not rows:raise SystemExit('No non-empty text samples in JSONL')
    tokenizer=AutoTokenizer.from_pretrained(a.model)
    if tokenizer.pad_token is None:tokenizer.pad_token=tokenizer.eos_token
    ds=Dataset.from_list(rows)
    def encode(batch):
        x=tokenizer(batch['text'],truncation=True,max_length=a.max_length,padding='max_length')
        x['labels']=[[tok if mask else -100 for tok,mask in zip(ids,masks)] for ids,masks in zip(x['input_ids'],x['attention_mask'])]
        return x
    ds=ds.map(encode,batched=True,remove_columns=['text'])
    model=AutoModelForCausalLM.from_pretrained(a.model);model.config.use_cache=False
    args=TrainingArguments(output_dir=a.output,num_train_epochs=a.epochs,per_device_train_batch_size=1,learning_rate=2e-5,save_strategy='epoch',logging_steps=5,report_to='none')
    trainer=Trainer(model=model,args=args,train_dataset=ds,data_collator=DataCollatorForLanguageModeling(tokenizer=tokenizer,mlm=False))
    trainer.train();trainer.save_model(a.output);tokenizer.save_pretrained(a.output)
    print(f'Saved Student model to {a.output}; samples={len(rows)}')
if __name__=='__main__':main()