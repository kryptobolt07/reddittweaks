// Enter dates through the same editable fields as a person using the picker.
function setDateSegments(root,bound,value){
  const input=root.querySelector(`input[data-bound="${bound}"]`),W=root.ownerDocument.defaultView;
  if(!input)throw Error('Missing '+bound+' date');const [year,month,day]=value.split('-');input.focus();input.value=day+'/'+month+'/'+year;input.dispatchEvent(new W.Event('input',{bubbles:true}));input.blur();
}
function setDateMode(root,mode){root.querySelector('.date-condition').click();root.querySelector(`[data-mode="${mode}"]`).click();}
module.exports={setDateSegments,setDateMode};
