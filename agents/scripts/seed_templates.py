"""Seed script to create sample checklist templates."""

import os
import sys
import uuid
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from services.firestore import FirestoreService
from models.checklist import ChecklistTemplate, CheckItem, Priority, Category


def create_sample_templates():
    """Create sample checklist templates for demo."""

    firestore = FirestoreService()

    # Template 1: Manufacturing/Factory
    factory_template = ChecklistTemplate(
        id=str(uuid.uuid4()),
        title="製造現場 作業終了チェック",
        description="製造ラインの作業終了時に確認すべき項目をまとめたチェックリストです",
        duration=600,  # 10 minutes
        items=[
            CheckItem(
                id="safety_1",
                topic="安全装置の確認",
                main_question="全ての安全装置は正常に動作していますか？異常があれば詳しく教えてください",
                follow_up_hints=["非常停止ボタン", "安全カバー", "センサー類"],
                priority=Priority.P0,
                category=Category.SAFETY,
                is_required=True,
                needs_photo=True,
            ),
            CheckItem(
                id="equipment_1",
                topic="設備の状態",
                main_question="設備に異常や故障はありましたか？",
                follow_up_hints=["異音", "振動", "温度", "動作不良"],
                priority=Priority.P1,
                category=Category.EQUIPMENT,
                is_required=True,
                needs_photo=True,
            ),
            CheckItem(
                id="task_1",
                topic="作業進捗",
                main_question="本日の作業の進捗状況を教えてください。予定通り完了しましたか？",
                follow_up_hints=["遅れ", "前倒し", "未完了の理由"],
                priority=Priority.P1,
                category=Category.TASK,
                is_required=True,
                needs_photo=False,
            ),
            CheckItem(
                id="equipment_2",
                topic="在庫・材料",
                main_question="材料や消耗品の在庫状況はどうですか？不足しているものはありますか？",
                follow_up_hints=["発注が必要なもの", "残量"],
                priority=Priority.P2,
                category=Category.EQUIPMENT,
                is_required=True,
                needs_photo=False,
            ),
            CheckItem(
                id="handover_1",
                topic="次担当への連絡事項",
                main_question="次の担当者に伝えておくべきことはありますか？",
                follow_up_hints=["注意点", "優先作業", "来客予定"],
                priority=Priority.P1,
                category=Category.HANDOVER,
                is_required=True,
                needs_photo=False,
            ),
            CheckItem(
                id="other_1",
                topic="清掃・整理整頓",
                main_question="作業エリアの清掃と整理整頓は完了しましたか？",
                follow_up_hints=["5S", "ゴミ処理"],
                priority=Priority.P3,
                category=Category.OTHER,
                is_required=False,
                needs_photo=False,
            ),
        ],
        knowledge_context="製造業の引き継ぎ。安全と品質が最優先。",
    )

    # Template 2: Office/IT
    office_template = ChecklistTemplate(
        id=str(uuid.uuid4()),
        title="オフィス 業務終了チェック",
        description="オフィスワークの業務終了時に確認すべき項目です",
        duration=300,  # 5 minutes
        items=[
            CheckItem(
                id="task_1",
                topic="未完了タスク",
                main_question="本日中に完了できなかったタスクはありますか？",
                follow_up_hints=["期限", "ブロッカー", "依頼事項"],
                priority=Priority.P1,
                category=Category.TASK,
                is_required=True,
                needs_photo=False,
            ),
            CheckItem(
                id="handover_1",
                topic="顧客対応",
                main_question="対応中の顧客案件で引き継ぎが必要なものはありますか？",
                follow_up_hints=["緊急度", "連絡待ち", "クレーム"],
                priority=Priority.P0,
                category=Category.HANDOVER,
                is_required=True,
                needs_photo=False,
            ),
            CheckItem(
                id="handover_2",
                topic="会議・予定",
                main_question="明日以降の重要な会議や予定で共有すべきものはありますか？",
                follow_up_hints=["準備物", "参加者", "議題"],
                priority=Priority.P2,
                category=Category.HANDOVER,
                is_required=True,
                needs_photo=False,
            ),
            CheckItem(
                id="equipment_1",
                topic="システム・ツール",
                main_question="使用しているシステムやツールに問題はありましたか？",
                follow_up_hints=["エラー", "動作遅延", "ログイン問題"],
                priority=Priority.P2,
                category=Category.EQUIPMENT,
                is_required=False,
                needs_photo=False,
            ),
            CheckItem(
                id="safety_1",
                topic="セキュリティ",
                main_question="重要書類の施錠、PCのロック等は完了していますか？",
                follow_up_hints=["機密書類", "来客対応", "鍵の管理"],
                priority=Priority.P1,
                category=Category.SAFETY,
                is_required=True,
                needs_photo=False,
            ),
        ],
        knowledge_context="一般的なオフィス業務。顧客対応の引き継ぎが重要。",
    )

    # Template 3: Retail/Store
    retail_template = ChecklistTemplate(
        id=str(uuid.uuid4()),
        title="店舗 閉店チェック",
        description="小売店舗の閉店時に確認すべき項目です",
        duration=480,  # 8 minutes
        items=[
            CheckItem(
                id="task_1",
                topic="レジ締め",
                main_question="レジの精算は完了しましたか？差異があれば教えてください",
                follow_up_hints=["過不足金額", "原因"],
                priority=Priority.P0,
                category=Category.TASK,
                is_required=True,
                needs_photo=False,
            ),
            CheckItem(
                id="equipment_1",
                topic="在庫確認",
                main_question="在庫切れや少なくなっている商品はありますか？",
                follow_up_hints=["人気商品", "発注済み", "棚補充"],
                priority=Priority.P2,
                category=Category.EQUIPMENT,
                is_required=True,
                needs_photo=False,
            ),
            CheckItem(
                id="handover_1",
                topic="クレーム・特記事項",
                main_question="本日発生したクレームや特記事項はありますか？",
                follow_up_hints=["対応状況", "お客様情報", "再来店予定"],
                priority=Priority.P0,
                category=Category.HANDOVER,
                is_required=True,
                needs_photo=False,
            ),
            CheckItem(
                id="safety_1",
                topic="店舗施錠",
                main_question="店舗の施錠、警備システムの設定は完了しましたか？",
                follow_up_hints=["全出入口", "金庫", "警備会社連絡"],
                priority=Priority.P0,
                category=Category.SAFETY,
                is_required=True,
                needs_photo=False,
            ),
            CheckItem(
                id="other_1",
                topic="明日の準備",
                main_question="明日のオープンに向けて準備しておくことはありますか？",
                follow_up_hints=["セール準備", "納品予定", "シフト"],
                priority=Priority.P2,
                category=Category.OTHER,
                is_required=False,
                needs_photo=False,
            ),
        ],
        knowledge_context="小売店舗の閉店作業。金銭管理とセキュリティが最重要。",
    )

    # Save templates
    templates = [factory_template, office_template, retail_template]

    for template in templates:
        try:
            firestore.create_template(template)
            print(f"Created template: {template.title} ({template.id})")
        except Exception as e:
            print(f"Error creating template {template.title}: {e}")

    print(f"\nCreated {len(templates)} sample templates")


if __name__ == "__main__":
    create_sample_templates()
