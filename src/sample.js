export const blankXML = '<mxfile host="Canvas to Slides"><diagram name="キャンバス" id="canvas"><mxGraphModel grid="1" gridSize="10" page="0" math="1"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';
export const demoXML = `<mxfile host="Canvas to Slides"><diagram name="研究キャンバス" id="research"><mxGraphModel grid="1" gridSize="10" page="0" math="1"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="palette-label" value="素材パレット — ここから自由にコピー" style="text;html=1;align=left;fontSize=20;fontColor=#516272;fontStyle=1;" vertex="1" parent="1"><mxGeometry x="60" y="-160" width="550" height="40" as="geometry"/></mxCell>
<mxCell id="palette-a" value="入力" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#e7eef3;strokeColor=#7b93a8;fontSize=17;" vertex="1" parent="1"><mxGeometry x="60" y="-100" width="130" height="50" as="geometry"/></mxCell>
<mxCell id="palette-b" value="処理" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f9e4d5;strokeColor=#d58b55;fontSize=17;" vertex="1" parent="1"><mxGeometry x="220" y="-100" width="130" height="50" as="geometry"/></mxCell>
<mxCell id="palette-c" value="観測" style="ellipse;whiteSpace=wrap;html=1;fillColor=#e3eee6;strokeColor=#76a087;fontSize=17;" vertex="1" parent="1"><mxGeometry x="390" y="-100" width="90" height="60" as="geometry"/></mxCell>
<mxCell id="note" value="研究メモ&lt;br&gt;・仮説を整理する&lt;br&gt;・次の実験条件を比較&lt;br&gt;・枠の外は出力されません" style="shape=note;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#e2c573;align=left;spacing=15;fontSize=17;" vertex="1" parent="1"><mxGeometry x="1110" y="-120" width="280" height="170" as="geometry"/></mxCell>
<mxCell id="title1" value="01  研究の全体像" style="text;html=1;align=left;fontColor=#203747;fontSize=34;fontStyle=1;" vertex="1" parent="1"><mxGeometry x="120" y="110" width="760" height="60" as="geometry"/></mxCell>
<mxCell id="subtitle1" value="キャンバス上の図から、伝えたい範囲を選ぶ" style="text;html=1;align=left;fontColor=#6c7b87;fontSize=19;" vertex="1" parent="1"><mxGeometry x="120" y="175" width="750" height="35" as="geometry"/></mxCell>
<mxCell id="input" value="問いを立てる" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#e7eef3;strokeColor=#8aa1b4;strokeWidth=2;fontSize=23;fontColor=#203747;" vertex="1" parent="1"><mxGeometry x="140" y="295" width="210" height="110" as="geometry"/></mxCell>
<mxCell id="process" value="実験・検証" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f9e4d5;strokeColor=#d58b55;strokeWidth=2;fontSize=23;fontColor=#774d2f;" vertex="1" parent="1"><mxGeometry x="435" y="295" width="210" height="110" as="geometry"/></mxCell>
<mxCell id="result" value="結果をまとめる" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#e3eee6;strokeColor=#76a087;strokeWidth=2;fontSize=23;fontColor=#345d44;" vertex="1" parent="1"><mxGeometry x="730" y="295" width="230" height="110" as="geometry"/></mxCell>
<mxCell id="edge1" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;strokeColor=#526b7c;strokeWidth=2;" edge="1" source="input" target="process" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>
<mxCell id="edge2" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;strokeColor=#526b7c;strokeWidth=2;" edge="1" source="process" target="result" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>
<mxCell id="footer1" value="図形と文字は、編集可能モードで個別に調整できます。" style="text;html=1;align=left;fontColor=#6c7b87;fontSize=17;" vertex="1" parent="1"><mxGeometry x="140" y="500" width="800" height="30" as="geometry"/></mxCell>
<mxCell id="title2" value="02  仮説を比較する" style="text;html=1;align=left;fontColor=#203747;fontSize=34;fontStyle=1;" vertex="1" parent="1"><mxGeometry x="1230" y="110" width="760" height="60" as="geometry"/></mxCell>
<mxCell id="subtitle2" value="作業メモや素材は、枠の外にそのまま残せます" style="text;html=1;align=left;fontColor=#6c7b87;fontSize=19;" vertex="1" parent="1"><mxGeometry x="1230" y="175" width="810" height="35" as="geometry"/></mxCell>
<mxCell id="hyp-a" value="仮説 A&lt;br&gt;観測条件を一定にする" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#e7eef3;strokeColor=#8aa1b4;strokeWidth=2;fontSize=23;fontColor=#203747;" vertex="1" parent="1"><mxGeometry x="1260" y="270" width="355" height="160" as="geometry"/></mxCell>
<mxCell id="hyp-b" value="仮説 B&lt;br&gt;観測条件を変化させる" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f9e4d5;strokeColor=#d58b55;strokeWidth=2;fontSize=23;fontColor=#774d2f;" vertex="1" parent="1"><mxGeometry x="1680" y="270" width="355" height="160" as="geometry"/></mxCell>
<mxCell id="footer2" value="＋で枠を追加すると、同じキャンバスで続きを作れます。" style="text;html=1;align=left;fontColor=#6c7b87;fontSize=17;" vertex="1" parent="1"><mxGeometry x="1260" y="500" width="800" height="30" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>`;

export async function loadDemo(bridge) {
  await bridge.loadXML(demoXML, '研究スライド・サンプル.drawio');
  const deck = bridge.getDecks()[0];
  bridge.updateDeck(deck.id, { name: '研究発表', ratio: '16:9', background: '#ffffff' });
  const first = bridge.createFrame({ deckId: deck.id, x: 60, y: 60, width: 960, height: 540, title: '研究の全体像' });
  bridge.createFrame({ deckId: deck.id, x: 1170, y: 60, width: 960, height: 540, title: '仮説を比較する' });
  bridge.focusFrame(first.id);
  return first;
}
